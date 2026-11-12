import { clinicalGuardrails } from "@/config/clinicalGuardrails";
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

async function queryGemini(parts: object[], systemInstruction: string, json = false): Promise<string> {
  const key = geminiKey();
  if (!key) throw new AIProviderError("Falta GEMINI_API_KEY en .env.");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.5 } : { temperature: 0.2 },
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
        continue;
      }
      throw new AIProviderError("No se pudo conectar con Gemini después de varios intentos.", 503);
    }

    if (response.ok) return textOf(await response.json());

    if ([500, 503, 504].includes(response.status) && attempt < 2) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
      continue;
    }

    if (response.status === 429) throw new AIProviderError("Gemini alcanzó su límite de solicitudes.", 429);
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError("La clave de Gemini no está autorizada.", response.status);
    }
    if (response.status === 503) {
      throw new AIProviderError("Gemini sigue temporalmente saturado (HTTP 503). Puedes desactivar el análisis visual para continuar con una foto sin enviarla a Google.", 503);
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

async function geminiDraft(procedure: string, context: string, style: "educativo" | "comercial"): Promise<DentalPost> {
  const system = [
    "Eres un redactor profesional de marketing odontológico en Colombia.",
    "Escribe español natural y humano, sin diagnósticos ni promesas clínicas.",
    "Nunca infieras enfermedades, resultados, características personales o hechos que no consten en el contexto.",
    `Solo menciona procedimientos permitidos: ${clinicalGuardrails.allowedDentalTerms.join(", ")}.`,
    `Evita estas expresiones: ${clinicalGuardrails.prohibitedRiskPhrases.join(", ")}.`,
    "Devuelve solamente JSON con caption (string), hashtags (lista de strings que empiezan con #) y suggestedCallToAction (string).",
  ].join("\n");
  const answer = await queryGemini([{ text: `Procedimiento: ${procedure}\nContexto: ${context}\nEstilo: ${style}. Para el comercial, invita a una valoración sin garantizar beneficios. No inventes información.` }], system, true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new AIProviderError("Gemini no devolvió JSON válido.", 502);
  }
  return checkDraft(parsed);
}

export async function generateDentalVariants(procedure: string, context: string) {
  if (!geminiKey()) {
    if (process.env.XAI_API_KEY || process.env.GROK_API_KEY) return generateWithGrok(procedure, context);
    throw new AIProviderError("Configura GEMINI_API_KEY en .env para generar contenido.");
  }

  try {
    const [educational, commercial] = await Promise.all([
      geminiDraft(procedure, context, "educativo"),
      geminiDraft(procedure, context, "comercial"),
    ]);
    return { educational, commercial };
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
