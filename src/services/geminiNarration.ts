const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
export const GEMINI_VOICES = ["Kore", "Puck", "Charon"] as const;
export type GeminiVoice = typeof GEMINI_VOICES[number];
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`;

export async function generateGeminiNarration(script: string, voice: GeminiVoice = "Kore", language: "es-CO" | "en-US" = "es-CO"): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Configura GEMINI_API_KEY para generar la narración.");
  const text = script.trim();
  if (!text || text.length > 2400) throw new Error("El guion de narración debe tener entre 1 y 2400 caracteres.");

  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${language === "en-US" ? "Read the following dental advertisement in natural American English with a warm, clear and conversational voice." : "Lee el siguiente anuncio en español de Colombia, con voz natural, clara, cercana y ritmo publicitario pausado."} Use a relaxed conversational pace around 115–135 words per minute. Preserve sentence pauses and take a short breath between paragraphs. Never rush to fit a time limit. Speak exactly the provided text, without adding words:\n\n${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("Gemini alcanzó el límite de generación de voz.");
    throw new Error(`Gemini no pudo generar la narración (HTTP ${response.status}).`);
  }

  const payload = await response.json() as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.flatMap(part => part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/") ? [part.inlineData] : []);
  if (!audio.length) {
    throw new Error("Gemini no devolvió audio. Prueba otra voz o utiliza ElevenLabs; revisa también la disponibilidad y cuota del modelo TTS.");
  }
  if (audio.some(part => !/^audio\/(?:L16|pcm)(?:;|$)/i.test(part.mimeType!) ||
      !/rate=24000(?:;|$)/i.test(part.mimeType!) || /channels=(?!1(?:;|$))/.test(part.mimeType!))) {
    throw new Error("Gemini devolvió un formato de audio no compatible: se requiere PCM mono a 24 kHz.");
  }
  const pcm = Buffer.concat(audio.map(part => Buffer.from(part.data!, "base64")));
  if (!pcm.length || pcm.length % 2 || pcm.length > 12_000_000) throw new Error("El audio generado es inválido o demasiado grande.");
  return pcm;
}
