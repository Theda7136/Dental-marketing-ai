const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const TTS_VOICE = "Kore";
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`;

export async function generateGeminiNarration(script: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Configura GEMINI_API_KEY para generar la narración.");
  const text = script.trim();
  if (!text || text.length > 1200) throw new Error("El guion de narración debe tener entre 1 y 1200 caracteres.");

  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Lee el siguiente anuncio en español de Colombia, con voz natural, clara, cercana y ritmo publicitario pausado. No agregues palabras.\n\n${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
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
  const audio = payload.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
  if (!audio?.data || !audio.mimeType?.includes("audio/")) {
    throw new Error("Gemini no devolvió audio para la narración.");
  }
  const pcm = Buffer.from(audio.data, "base64");
  if (!pcm.length || pcm.length > 12_000_000) throw new Error("El audio generado es inválido o demasiado grande.");
  return pcm;
}
