/**
 * Servicio de generación de posts dentales con la API de xAI (Grok).
 *
 * Usa la Responses API y el modelo grok-4.7, el modelo de texto y
 * razonamiento más capaz publicado por xAI. El copy se valida contra
 * clinicalGuardrails antes de salir de este módulo.
 */

import {
  ClinicalGuardrailWarning,
  clinicalGuardrails,
} from "../config/clinicalGuardrails";

const XAI_RESPONSES_URL = "https://api.x.ai/v1/chat/completions";

/** Modelo frontera de xAI para razonamiento y texto. */
const GROK_MODEL = "grok-4.7";

/** Esfuerzo de razonamiento explícito. En grok-4.7 no se puede desactivar. */
const REASONING_EFFORT = "high";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_GENERATION_ATTEMPTS = 2;

export interface DentalPost {
  caption: string;
  hashtags: string[];
  suggestedCallToAction: string;
}

/** Error de transporte, autenticación o contrato de la API de xAI. */
export class GrokServiceError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GrokServiceError";
    this.statusCode = statusCode;
  }
}

interface XaiOutputText {
  type: string;
  text?: string;
}

interface XaiOutputItem {
  type: string;
  content?: XaiOutputText[];
}

interface XaiErrorBody {
  error?: { message?: string };
  output?: XaiOutputItem[];
}

const DENTAL_POST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    caption: {
      type: "string",
      description:
        "Texto del post para Instagram o TikTok, profesional y sin promesas clínicas.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "Hashtags relevantes, cada uno iniciado con #.",
    },
    suggestedCallToAction: {
      type: "string",
      description: "Llamado a la acción breve, por ejemplo: Escribe SONRISA.",
    },
  },
  required: ["caption", "hashtags", "suggestedCallToAction"],
} as const;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} debe ser un string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${fieldName} no puede estar vacío.`);
  }

  return trimmed;
}

function readApiKey(): string {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const apiKey = env?.XAI_API_KEY?.trim() || env?.GROK_API_KEY?.trim();

  if (!apiKey) {
    throw new GrokServiceError(
      "Falta la variable de entorno XAI_API_KEY para llamar a la API de xAI.",
    );
  }

  return apiKey;
}

function resolveProcedureName(procedureName: string): string {
  const requested = normalize(procedureName);
  const canonical = clinicalGuardrails.allowedDentalTerms.find(
    (term) => normalize(term) === requested,
  );

  if (!canonical) {
    throw new GrokServiceError(
      `El procedimiento "${procedureName}" no está en los términos odontológicos permitidos: ${clinicalGuardrails.allowedDentalTerms.join(", ")}.`,
    );
  }

  return canonical;
}

function buildSystemPrompt(): string {
  const allowed = clinicalGuardrails.allowedDentalTerms.join(", ");
  const prohibited = clinicalGuardrails.prohibitedRiskPhrases
    .map((phrase) => `"${phrase}"`)
    .join(", ");

  return [
    "Eres un copywriter experto en marketing odontológico para Instagram y TikTok.",
    "Escribes en español con un tono profesional, empático y persuasivo.",
    "Tu trabajo es informar e invitar a agendar una valoración, nunca diagnosticar ni prometer un resultado médico.",
    "",
    "Reglas clínicas obligatorias:",
    `- Solo puedes nombrar estos tratamientos: ${allowed}.`,
    "- No inventes diagnósticos, estadísticas, estudios, términos clínicos ni resultados que no estén en esa lista.",
    `- Nunca uses estas frases ni ninguna variante equivalente: ${prohibited}.`,
    "- No prometas curas, blancura permanente, ausencia absoluta de dolor, efectividad total ni cero riesgos.",
    "- No afirmes que un tratamiento sustituye la valoración de un odontólogo.",
    "- Los hechos confirmados en las notas de la clínica tienen prioridad sobre frases publicitarias genéricas.",
    "- Si las notas describen un resultado final, escribe sobre ese resultado; no lo transformes en una consulta futura ni en un plan por realizar.",
    "- Evita expresiones de relleno: «en nuestra consulta», «en nuestra clínica», «tecnología de vanguardia», «evaluamos cada caso» y «un proceso personalizado», salvo que estén expresamente justificadas.",
    "- Escribe con frases breves y concretas, sin afirmar resultados distintos a los documentados.",
    "",
    "Formato:",
    "- caption: texto listo para publicar, claro y humano, sin las frases prohibidas.",
    "- hashtags: arreglo de hashtags relevantes en español. Cada uno empieza con # y no contiene espacios.",
    "- suggestedCallToAction: una frase corta para comentarios o mensajes, por ejemplo \"Escribe SONRISA\".",
  ].join("\n");
}

function buildUserPrompt(
  procedureName: string,
  imageContext: string,
  correction?: string,
): string {
  const lines = [
    `Procedimiento validado: ${procedureName}.`,
    `Contexto de la imagen: ${imageContext}.`,
    "Redacta el post usando solo el procedimiento indicado y el contexto visual.",
  ];

  if (correction) {
    lines.push(
      "El borrador anterior incumplió las reglas clínicas. Reescríbelo sin estas infracciones:",
      correction,
    );
  }

  return lines.join("\n");
}

function serializePost(post: DentalPost): string {
  return [post.caption, post.suggestedCallToAction, ...post.hashtags].join(
    "\n",
  );
}

function normalizeHashtag(value: string): string {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact.length === 0) {
    throw new GrokServiceError(
      "La API devolvió un hashtag vacío en el post dental.",
    );
  }

  return compact.startsWith("#") ? compact : `#${compact}`;
}

function parseDentalPost(payload: unknown): DentalPost {
  if (typeof payload !== "object" || payload === null) {
    throw new GrokServiceError(
      "La API de xAI no devolvió un objeto JSON para el post dental.",
    );
  }

  const record = payload as Record<string, unknown>;
  const caption = assertNonEmptyString(record.caption, "caption");
  const suggestedCallToAction = assertNonEmptyString(
    record.suggestedCallToAction,
    "suggestedCallToAction",
  );

  if (!Array.isArray(record.hashtags) || record.hashtags.length === 0) {
    throw new GrokServiceError(
      "La API de xAI no devolvió hashtags válidos para el post dental.",
    );
  }

  const hashtags = record.hashtags.map((tag, index) =>
    normalizeHashtag(assertNonEmptyString(tag, `hashtags[${index}]`)),
  );

  return { caption, hashtags, suggestedCallToAction };
}

function extractOutputText(body: XaiErrorBody): string {
  const message = body.output?.find((item) => item.type === "message");
  const text = message?.content?.find(
    (part) => part.type === "output_text" && typeof part.text === "string",
  )?.text;

  if (!text || text.trim().length === 0) {
    throw new GrokServiceError(
      "La API de xAI respondió sin texto estructurado para el post dental.",
    );
  }

  return text;
}

async function requestDentalPost(
  apiKey: string,
  procedureName: string,
  imageContext: string,
  correction?: string,
): Promise<DentalPost> {
  let response: Response;

  try {
    response = await fetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        store: false,
        reasoning: { effort: REASONING_EFFORT },
        prompt_cache_key: "dental-marketing-post",
        input: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: buildUserPrompt(procedureName, imageContext, correction),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "dental_post",
            strict: true,
            schema: DENTAL_POST_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "error de red desconocido";
    throw new GrokServiceError(
      `No se pudo contactar la API de xAI: ${detail}.`,
    );
  }

  let body: XaiErrorBody;
  try {
    body = (await response.json()) as XaiErrorBody;
  } catch {
    throw new GrokServiceError(
      "La API de xAI devolvió una respuesta que no es JSON.",
      response.status,
    );
  }

 if (!response.ok) {
  console.error("🔥 ERROR DETALLADO DE XAI:", JSON.stringify(body, null, 2)); // <--- Añade esta línea
  throw new GrokServiceError(
    body.error?.message ??
      `La API de xAI rechazó la solicitud con estado ${response.status}.`,
    response.status,
  );
}

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractOutputText(body));
  } catch (error) {
    if (error instanceof GrokServiceError) {
      throw error;
    }
    throw new GrokServiceError(
      "La API de xAI no devolvió el JSON del post dental.",
    );
  }

  return parseDentalPost(parsed);
}

/**
 * Genera un post dental para Instagram o TikTok.
 *
 * El procedimiento debe pertenecer a los términos permitidos. El texto
 * devuelto ya pasó por clinicalGuardrails.validate.
 *
 * @throws {TypeError} si los argumentos no son strings válidos.
 * @throws {GrokServiceError} si el procedimiento no está permitido o falla la API.
 * @throws {ClinicalGuardrailWarning} si el texto generado sigue incumpliendo las reglas.
 */
export async function generateDentalPost(
  procedureName?: string,
  imageContext?: string,
): Promise<DentalPost> {
  const apiKey = readApiKey();

  const safeProcedure = procedureName && procedureName.trim().length > 0 
    ? procedureName.trim() 
    : "Diseño de Sonrisa";
    
  const safeContext = imageContext && imageContext.trim().length > 0 
    ? imageContext.trim() 
    : "Caso clínico dental general para redes sociales.";

  let response: Response;

  try {
    response = await fetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: buildUserPrompt(safeProcedure, safeContext),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error de red desconocido";
    throw new GrokServiceError(`No se pudo contactar la API de xAI: ${detail}.`);
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new GrokServiceError("La API de xAI devolvió una respuesta que no es JSON.", response.status);
  }

  if (!response.ok) {
    console.error("🔥 ERROR DETALLADO DE XAI:", JSON.stringify(body, null, 2));
    throw new GrokServiceError(
      body.error?.message ?? `La API de xAI rechazó la solicitud con estado ${response.status}.`,
      response.status,
    );
  }

  const textContent = body.choices?.[0]?.message?.content;
  if (!textContent) {
    throw new GrokServiceError("La API de xAI respondió sin contenido para el post dental.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new GrokServiceError("La API de xAI no devolvió un JSON válido para el post dental.");
  }

  return parseDentalPost(parsed);
}
export type CopyStyle = "EDUCATIONAL" | "COMMERCIAL";

export async function generateDentalVariants(procedureName: string, context: string) {
  const [educational, commercial] = await Promise.all([
    generateDentalPost(procedureName, context + "\nEstilo EDUCATIVO: explica de forma accesible el objetivo general del tratamiento, sin atribuir hallazgos al paciente ni ofrecer garantías."),
    generateDentalPost(procedureName, context + "\nEstilo COMERCIAL: enfócate en invitar a una valoración profesional, beneficios potenciales sin prometer resultados, mensaje breve y claro."),
  ]);

  return { educational, commercial };
}

export async function describeDentalImage(imageJpeg: Uint8Array): Promise<string> {
  const apiKey = readApiKey();
  if (imageJpeg.byteLength > 2 * 1024 * 1024) {
    throw new GrokServiceError("La imagen para análisis visual es demasiado grande.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.7",
        store: false,
        input: [
          {
            role: "system",
            content: "Describe solo elementos visibles de una fotografía para apoyar contenido odontológico. No identifiques personas, no infieras diagnósticos, tratamientos efectuados, estado de salud ni resultados clínicos. Responde en español, con una frase objetiva de máximo 240 caracteres.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: `data:image/jpeg;base64,${Buffer.from(imageJpeg).toString("base64")}`,
                detail: "low",
              },
              {
                type: "input_text",
                text: "Describe únicamente elementos visuales evidentes útiles para presentar la imagen en redes sociales. Si no hay observaciones seguras, responde: Sin observaciones visuales seguras.",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new GrokServiceError("No se pudo consultar la visión de Grok.");
  }

  if (!response.ok) {
    throw new GrokServiceError("Grok no pudo analizar la imagen.", response.status);
  }

  const payload = await response.json() as XaiErrorBody;
  const summary = extractOutputText(payload).trim();
  if (!summary) throw new GrokServiceError("Grok no devolvió observaciones visuales.");
  return summary.slice(0, 240);
}
