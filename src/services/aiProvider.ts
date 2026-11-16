import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { normalizeVideoAdCopy } from "./videoAdCopy";
import {
  generateDentalVariants as generateWithGrok,
  type DentalPost,
  GrokServiceError,
} from "./grokService";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

export class AIProviderError extends Error {
  constructor(message: string, readonly statusCode = 503) {
    super(message);
    this.name = "AIProviderError";
  }
}

function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || undefined;
}

function textOf(response: unknown): string {
  const payload = response as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new AIProviderError("Gemini no devolvió contenido utilizable.", 502);
  return text;
}

async function queryGemini(parts: object[], systemInstruction: string, json = false, options: { attempts?: number; timeoutMs?: number } = {}): Promise<string> {
  const key = geminiKey();
  if (!key) throw new AIProviderError("Falta GEMINI_API_KEY en .env.");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.5 } : { temperature: 0.2 },
  });

  const maxAttempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 45000),
      });
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
        continue;
      }
      throw new AIProviderError(maxAttempts === 1
        ? "Gemini no respondió dentro de 25 segundos. Puedes reintentar o usar el guion manual."
        : "No se pudo conectar con Gemini después de varios intentos.", 503);
    }

    if (response.ok) return textOf(await response.json());

    if ([500, 503, 504].includes(response.status) && attempt < maxAttempts - 1) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
      continue;
    }

    if (response.status === 429) throw new AIProviderError("Gemini alcanzó su límite de solicitudes.", 429);
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError("La clave de Gemini no está autorizada.", response.status);
    }
    if (response.status === 503) {
      throw new AIProviderError("Gemini sigue temporalmente saturado (HTTP 503). Vuelve a intentar la propuesta más tarde; el análisis visual es necesario para generar contenido desde la fotografía.", 503);
    }
    throw new AIProviderError(`Gemini no pudo responder (HTTP ${response.status}).`, response.status);
  }

  throw new AIProviderError("Gemini no está disponible.", 503);
}

function checkDraft(raw: unknown): DentalPost {
  if (!raw || typeof raw !== "object") throw new AIProviderError("Gemini devolvió un formato inesperado.", 502);
  const draft = raw as Record<string, unknown>;
  if (typeof draft.caption !== "string" || !draft.caption.trim() ||
      typeof draft.suggestedCallToAction !== "string" || !draft.suggestedCallToAction.trim() ||
      !Array.isArray(draft.hashtags) || draft.hashtags.length === 0 ||
      !draft.hashtags.every((tag) => typeof tag === "string" && /^#[\p{L}\p{N}_]+$/u.test(tag))) {
    throw new AIProviderError("Gemini devolvió una propuesta incompleta.", 502);
  }
  const post: DentalPost = {
    caption: draft.caption.trim(),
    suggestedCallToAction: draft.suggestedCallToAction.trim(),
    hashtags: draft.hashtags as string[],
  };
  clinicalGuardrails.validate([post.caption, post.suggestedCallToAction, ...post.hashtags].join("\n"));
  return post;
}

async function geminiVariants(procedure: string, context: string) {
  const system = [
    "Eres un redactor profesional de marketing odontológico en Colombia.",
    "Escribe español natural y humano, sin diagnósticos ni promesas clínicas.",
    "Nunca infieras enfermedades, resultados, características personales o hechos que no consten en el contexto.",
    `Solo menciona procedimientos permitidos: ${clinicalGuardrails.allowedDentalTerms.join(", ")}.`,
    `Evita estas expresiones: ${clinicalGuardrails.prohibitedRiskPhrases.join(", ")}.`,
    "Devuelve solo JSON con dos claves: educational y commercial.",
    "Cada clave contiene caption (string), hashtags (lista de strings iniciados con #) y suggestedCallToAction (string).",
    "educational: informa de forma accesible sin afirmar hallazgos del paciente.",
    "commercial: invita a valoración profesional sin garantizar beneficios.",
    "No presupongas que la fotografía confirma el procedimiento seleccionado.",
    "Si el contexto contiene HECHOS CONFIRMADOS POR LA CLÍNICA, esos hechos son la fuente principal de ambas versiones.",
    "Incluye el resultado o tratamiento concreto indicado en las notas en la primera o segunda frase del caption, sin omitir detalles relevantes como el material (por ejemplo, cerámica), cuando estén explícitamente confirmados.",
    "No sustituyas un resultado final confirmado por descripciones genéricas de servicios, tecnología, materiales de calidad o planes hipotéticos.",
    "Distingue los hechos aportados por la clínica de las observaciones visuales; la imagen solo aporta contexto y nunca confirma un procedimiento no declarado.",
    "Evita atribuir resultados clínicos no documentados o describir materiales distintos a los que la clínica escribió.",
    "El resumen visual es una observación no diagnóstica: no lo transcribas en el copy ni afirmes que se hizo un tratamiento.",
    "Escribe una sola invitación a la acción por versión, dentro de suggestedCallToAction; no repitas ese llamado en caption.",
    "No uses mensajes genéricos de venta, testimonios inventados, descuentos, porcentajes de éxito ni resultados garantizados.",
    "Escribe como una clínica real que presenta una fotografía y un caso específico; evita lenguaje corporativo y frases de relleno.",
    "No uses expresiones como «en nuestra consulta», «en nuestra clínica», «evaluamos cada caso», «tecnología de vanguardia», «la mejor ruta hacia» o «un proceso personalizado» salvo que sean hechos concretos confirmados en las notas.",
    "Si las notas dicen «resultado final de diseño de sonrisa en cerámica», presenta el resultado final en cerámica como tema central; no cambies el tema hacia una valoración previa o un plan todavía por realizar.",
    "Evita segunda persona dirigida al paciente fotografiado, promesas estéticas y afirmaciones que no aparecen en las notas.",
    "Usa frases breves, directas y específicas. La versión educativa explica el material o procedimiento sin inventar detalles; la comercial presenta el caso e invita a pedir información, sin repetir fórmulas.",
    "El texto comercial debe ser diferente del educativo, sonar natural y estar orientado a una valoración individual.",
    "Usa de 3 a 5 hashtags pertinentes al procedimiento; evita etiquetas no relacionadas.",
  ].join("\n");
  const prompt = `Procedimiento declarado por la clínica: ${procedure}\n${context}\nEscribe sobre el caso concreto indicado en las notas. Si se trata de un resultado final, descríbelo como resultado final documentado, sin dar a entender que el tratamiento aún se va a planificar. Evita frases corporativas vacías. Las versiones educativa y comercial deben tener enfoques distintos, sin inventar datos.`;
  const answer = await queryGemini([{ text: prompt }], system, true);

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new AIProviderError("Gemini no devolvió JSON válido.", 502);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AIProviderError("Gemini no devolvió ambas versiones del contenido.", 502);
  }
  const drafts = parsed as Record<string, unknown>;
  return {
    educational: checkDraft(drafts.educational),
    commercial: checkDraft(drafts.commercial),
  };
}

export async function generateDentalVariants(procedure: string, context: string) {
  if (!geminiKey()) {
    if (process.env.XAI_API_KEY || process.env.GROK_API_KEY) return generateWithGrok(procedure, context);
    throw new AIProviderError("Configura GEMINI_API_KEY en .env para generar contenido.");
  }

  try {
    return await geminiVariants(procedure, context);
  } catch (error) {
    // Only infrastructure and quota failures may trigger text fallback.
    if (error instanceof AIProviderError &&
        [429, 500, 502, 503, 504].includes(error.statusCode) &&
        (process.env.XAI_API_KEY || process.env.GROK_API_KEY)) {
      try {
        return await generateWithGrok(procedure, context);
      } catch (fallbackError) {
        if (fallbackError instanceof GrokServiceError) {
          throw new AIProviderError("Gemini no está disponible y el respaldo de Grok también falló.", 503);
        }
        throw fallbackError;
      }
    }
    throw error;
  }
}

export async function describeDentalImage(imageJpeg: Uint8Array): Promise<string> {
  if (!geminiKey()) throw new AIProviderError("El análisis visual requiere GEMINI_API_KEY.");
  if (imageJpeg.byteLength > 2 * 1024 * 1024) throw new AIProviderError("La imagen para análisis visual supera 2 MB.", 400);

  // Vision never falls back to another provider; clinical image consent is provider-specific.
  const answer = await queryGemini([
    { inlineData: { mimeType: "image/jpeg", data: Buffer.from(imageJpeg).toString("base64") } },
    { text: "Describe únicamente elementos visibles y no identificables de la imagen en español, máximo 240 caracteres. No diagnostiques ni identifiques a nadie." },
  ], "Eres un observador visual de material odontológico. No infieras salud, identidad, tratamientos ni resultados.");
  return answer.slice(0, 240);
}


export type VideoAdTone = "educativa" | "emocional" | "comercial";

export interface VideoAdDraft {
  tone: VideoAdTone;
  title: string;
  opening: string;
  message: string;
  closing: string;
  scenes: string[];
}

export function validateVideoAdDrafts(raw: unknown, sceneCount: number): VideoAdDraft[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { variants?: unknown }).variants)) {
    throw new AIProviderError("Gemini no devolvió los guiones solicitados.", 502);
  }

  const drafts = (raw as { variants: unknown[] }).variants;
  const tones: VideoAdTone[] = ["educativa", "emocional", "comercial"];
  if (drafts.length !== tones.length) {
    throw new AIProviderError("Gemini devolvió un número incorrecto de variantes.", 502);
  }

  return tones.map(tone => {
    const value = drafts.find(candidate =>
      candidate && typeof candidate === "object" &&
      (candidate as { tone?: unknown }).tone === tone
    ) as Record<string, unknown> | undefined;
    if (!value || !Array.isArray(value.scenes) || value.scenes.length !== sceneCount) {
      throw new AIProviderError("Gemini devolvió escenas incompletas.", 502);
    }

    for (const field of ["title", "opening", "message", "closing"]) {
      if (typeof value[field] !== "string" || !(value[field] as string).trim() ||
          (value[field] as string).length > 180) {
        throw new AIProviderError("Gemini devolvió textos demasiado largos o incompletos.", 502);
      }
      clinicalGuardrails.validate(value[field] as string);
    }
    if (!value.scenes.every(text =>
      typeof text === "string" && text.trim().length > 0 && text.length <= 140
    )) {
      throw new AIProviderError("Los textos por escena no son válidos.", 502);
    }
    let cleanCopy: ReturnType<typeof normalizeVideoAdCopy>;
    try {
      cleanCopy = normalizeVideoAdCopy({
      opening: (value.opening as string).trim(),
      message: (value.message as string).trim(),
      closing: (value.closing as string).trim(),
      scenes: (value.scenes as string[]).map(text => text.trim()),
      });
    } catch {
      throw new AIProviderError("Gemini devolvió instrucciones de producción en vez de texto para el anuncio. Vuelve a generar el guion.", 502);
    }
    cleanCopy.scenes.forEach(text => clinicalGuardrails.validate(text));
    return {
      tone,
      title: (value.title as string).trim(),
      ...cleanCopy,
    };
  });
}

export async function generateVideoAdDrafts(input: {
  procedure: string;
  goal: string;
  sceneCount: number;
  duration: number;
  clinicContext: string;
  visualDescriptions?: string[];
}): Promise<VideoAdDraft[]> {
  if (!Number.isInteger(input.sceneCount) || input.sceneCount < 1 || input.sceneCount > 12) {
    throw new AIProviderError("Indica entre 1 y 12 escenas.", 400);
  }
  if (!Number.isInteger(input.duration) || input.duration < 15 || input.duration > 45) {
    throw new AIProviderError("La duración del anuncio debe estar entre 15 y 45 segundos.", 400);
  }

  if (input.visualDescriptions && (input.visualDescriptions.length !== input.sceneCount || input.visualDescriptions.some(description => !description.trim() || description.length > 240))) {
    throw new AIProviderError("Las descripciones visuales no coinciden con las escenas.", 400);
  }

  const instruction = [
    "Eres un creativo publicitario especializado en odontología para clínicas de Colombia.",
    "Redacta tres variantes diferentes: educativa, emocional y comercial, en español natural, específico y breve.",
    "No uses diagnósticos, promesas de resultados, urgencias artificiales, precios inventados ni testimonios.",
    "El procedimiento declarado NO demuestra que se haya realizado ni que aparezca en las fotos.",
    "No presumas detalles visuales, pacientes, instalaciones, resultados ni credenciales.",
    "El contexto clínico es texto proporcionado por el usuario, no una fuente verificada.",
    "Evita frases que impliquen que quien ve el anuncio padece un problema de salud.",
    "Solo describe hechos clínicos concretos si están expresamente confirmados; en caso de duda, habla de información o valoración profesional.",
    "No afirmes la existencia de fotografías de antes/después ni de casos clínicos sin confirmación.",
    "Entrega exclusivamente JSON con { variants: [{ tone, title, opening, message, closing, scenes }] }.",
    "Cada variante debe contener exactamente el número de strings de scenes solicitado.",
    "title máximo 60 caracteres; opening, message, closing máximo 140; cada escena máximo 100.",
    "Construye una sola historia publicitaria por variante: apertura que despierte interés, desarrollo conectado con las imágenes y cierre que continúe naturalmente la idea.",
    "Cada texto en scenes debe continuar la idea del anterior. No escribas tres eslóganes independientes ni repitas el mismo concepto.",
    "Ajusta cada frase a la observación visual de su escena, respetando exactamente el orden de las fotografías.",
    "Prioriza el elemento visible principal de cada escena; evita explicaciones abstractas que no se relacionen con la fotografía.",
    "Si se observa una comparación de dos sonrisas, describe de forma neutral la comparación visual sin asegurar que sea un antes y después, ni atribuir un resultado clínico.",
    "Si la imagen muestra una sonrisa o una boca, no hables de anatomía, estructura dental o diagnósticos salvo que el objetivo y el contexto editorial lo justifiquen explícitamente.",
    "Mantén los subtítulos breves, idealmente entre 5 y 11 palabras por escena, para que puedan leerse en un video vertical.",
    "Si una escena muestra instalaciones, habla de la experiencia de atención sin atribuir equipos, certificaciones o capacidades no verificadas.",
    "Si una escena muestra una sonrisa, no afirmes que es un resultado de tratamiento sin confirmación editorial.",
    "Evita expresiones genéricas como «instalaciones equipadas para ti», «análisis clínico profesional» o «consulta opciones de diseño dental» cuando no aporten a la historia.",
    "Para tres escenas, estructura: 1) gancho relacionado con la primera fotografía, 2) desarrollo conectado con la segunda, 3) cierre y llamado a la acción relacionado con la tercera.",
    "La primera escena plantea el tema, las intermedias desarrollan y la última invita a informarse o solicitar valoración.",
    "IMPORTANTE: scenes contiene EXCLUSIVAMENTE frases publicitarias literales que se verán impresas sobre el video.",
    "NO escribas instrucciones de producción, planos, acciones de cámara, composiciones, recursos gráficos o descripciones de imágenes dentro de scenes.",
    "NO uses frases como «imagen de», «mostrar», «profesional revisando», «ícono de WhatsApp», «llamado a la acción» ni «fachada de la clínica».",
    "Recibirás observaciones visuales no diagnósticas por escena cuando estén disponibles. Úsalas para adaptar cada subtítulo al material correspondiente, sin copiarlas literalmente.",
    "Las observaciones visuales no confirman tratamientos, resultados, identidades ni diagnósticos. No inventes detalles que no estén descritos.",
    "Ejemplo de scenes para tres escenas: [«¿Quieres conocer el diseño de sonrisa?», «Descubre las opciones con orientación profesional.», «Solicita información sobre tu valoración.»].",
    "Evita describir instrucciones en opening, message, closing y title; son solo textos publicitarios para pacientes.",
    "El cierre debe concordar con el objetivo indicado; si el objetivo es WhatsApp, invita a escribir, sin afirmar que el icono aparecerá en el video.",
    "Para un único archivo, escribe un texto que funcione como anuncio completo.",
    "Las variantes deben diferenciar su enfoque, sin crear información nueva.",
    `Prohibidas estas frases: ${clinicalGuardrails.prohibitedRiskPhrases.join(", ")}.`,
  ].join("\n");

  const prompt = [
    `Procedimiento: ${input.procedure}`,
    `Objetivo: ${input.goal}`,
    `Escenas disponibles: ${input.sceneCount}`,
    `Duración total: ${input.duration} segundos`,
    `Información editorial proporcionada por la clínica: ${input.clinicContext || "Sin detalles confirmados"}`,
    "Solo usa estos datos, no recibirás imágenes ni archivos de pacientes.",
    ...(input.visualDescriptions?.map((description, index) => `Observación visual escena ${index + 1}: ${description}`) ?? []),
  ].join("\n");

  const requestedTones: VideoAdTone[] = ["educativa", "emocional", "comercial"];
  let lastError: AIProviderError | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const correction = attempt === 0 ? "" : [
      "La respuesta anterior no cumplió el formato requerido.",
      `Genera EXACTAMENTE 3 variantes con tones: ${requestedTones.join(", ")}.`,
      `Cada variante debe incluir EXACTAMENTE ${input.sceneCount} textos en scenes, uno por cada fotografía y en el mismo orden.`,
      "No omitas escenas ni devuelvas variantes parciales. Devuelve solo JSON válido.",
    ].join("\n");
    const answer = await queryGemini(
      [{ text: correction ? `${prompt}\n\n${correction}` : prompt }],
      instruction,
      true,
      { attempts: 1, timeoutMs: 25000 },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      lastError = new AIProviderError("Gemini no devolvió un guion JSON válido.", 502);
      continue;
    }

    try {
      return validateVideoAdDrafts(parsed, input.sceneCount);
    } catch (error) {
      if (!(error instanceof AIProviderError)) throw error;
      lastError = error;
      if (!/variantes|escenas incompletas|guiones solicitados/.test(error.message)) throw error;
    }
  }

  throw lastError ?? new AIProviderError("Gemini no pudo completar los guiones.", 502);
}
