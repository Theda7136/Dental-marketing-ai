import { generateGeminiNarration, type GeminiVoice } from "./geminiNarration";
import { generateElevenLabsTimedNarration } from "./elevenLabsNarration";
import { compactNarration, narrationDurations, pcmWave, validateNarrationCoverage, ShortNarrationError, type NarrationTrack } from "./videoAdTimeline";

// One measured repair only. Provider, alignment and clinical failures never trigger
// another paid synthesis. A failed repair is not exported as a padded success.
export async function generateMeasuredVideoAdNarration(
  segments: string[], provider: "gemini" | "elevenlabs", voice: GeminiVoice, language: "en-US" | "es-CO", targetSeconds: number,
  rewrite: (segments: string[], measuredSeconds: number) => Promise<string[]>,
): Promise<NarrationTrack & { segments: string[] }> {
  try {
    return { ...await generateVideoAdNarration(segments, provider, voice, language, targetSeconds), segments };
  } catch (error) {
    if (!(error instanceof ShortNarrationError) || error.seconds >= targetSeconds * 0.8) throw error;
    const revised = await rewrite([...segments], error.seconds);
    if (revised.length !== segments.length || revised.some(text => !text.trim()) || revised.join("\n") === segments.join("\n")) {
      throw new Error("La reescritura no amplió el guion completo.");
    }
    return { ...await generateVideoAdNarration(revised, provider, voice, language, targetSeconds), segments: revised };
  }
}

export async function generateVideoAdNarration(
  segments: string[], provider: "gemini" | "elevenlabs", voice: GeminiVoice, language: "en-US" | "es-CO", targetSeconds?: number,
): Promise<NarrationTrack> {
  segments = segments.map(segment => segment.trim());
  const text = segments.join("\n");
  if (!segments.length || segments.length > 13 || segments.some(segment => !segment.trim()) || text.length > 2400) {
    throw new Error("Completa la locución de todas las escenas y limita la narración a 2400 caracteres.");
  }
  const checkDuration = (track: NarrationTrack) => {
    if (targetSeconds !== undefined) {
      const seconds = track.pcm.length / 48000;
      if (seconds > Math.min(targetSeconds * 0.9, targetSeconds - segments.length * 0.25)) {
        throw new Error("Acorta el guion: la voz necesita más tiempo y no se acelerará.");
      }
      validateNarrationCoverage(track.pcm, targetSeconds);
    }
    return track;
  };
  if (provider === "elevenlabs") {
    const track = await generateElevenLabsTimedNarration(segments, language);
    narrationDurations(track, segments.length);
    return checkDuration(track);
  }
  const { pcm } = compactNarration(await generateGeminiNarration(text, voice, language));
  if (pcm.length / 48000 > 60) throw new Error("Acorta el guion: la narración supera 60 segundos.");
  if (segments.length === 1) return checkDuration({ pcm, starts: [0] });
  // Gemini TTS does not return alignment. Analyze the actual generated audio,
  // never estimate scene boundaries from character counts or requested duration.
  const model = process.env.GEMINI_ALIGNMENT_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY!.trim() },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "audio/wav", data: pcmWave(pcm).toString("base64") } },
        { text: `Listen to this audio and align these exact consecutive transcript segments. Return JSON {"segments":[{"text":"exact supplied segment","start":0,"end":1.2}]}. Times are numeric seconds measured in the audio, not estimates from text length. Include every segment in order, with no invented words. If speech differs or is incomplete, return {"segments":[]}. Transcript: ${JSON.stringify(segments)}` },
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("No se pudo obtener la sincronización de Gemini. Intenta nuevamente.");
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("");
  let aligned: { text: string; start: number; end: number }[];
  try { aligned = JSON.parse(raw).segments; } catch { throw new Error("Gemini devolvió una sincronización inválida."); }
  const duration = pcm.length / 48000;
  if (!Array.isArray(aligned) || aligned.length !== segments.length || aligned.some((item, i) =>
    !item || item.text !== segments[i] || !Number.isFinite(item.start) || !Number.isFinite(item.end) ||
    item.start < 0 || item.end <= item.start || item.end > duration + 0.05 ||
    (i === 0 && item.start > 0.3) || (i > 0 && (item.start < aligned[i - 1].end - 0.05 || item.start - aligned[i - 1].end > 3))
  ) || duration - aligned[aligned.length - 1].end > 3) {
    throw new Error("La voz no coincide con el guion completo. Vuelve a generar la narración.");
  }
  const track = { pcm, starts: aligned.map((item, i) => i === 0 ? 0 : item.start) };
  narrationDurations(track, segments.length);
  return checkDuration(track);
}
