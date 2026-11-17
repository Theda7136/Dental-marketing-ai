import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export async function generateElevenLabsNarration(script: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) {
    throw new Error("Configura ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID en .env.");
  }

  const text = script.trim();
  if (!text || text.length > 1200) {
    throw new Error("El texto de narración debe tener entre 1 y 1200 caracteres.");
  }

  const response = await fetch(`${API_URL}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error("La API key de ElevenLabs no es válida.");
    if (response.status === 402 || response.status === 429) {
      throw new Error("ElevenLabs no tiene créditos disponibles o alcanzó su límite de uso.");
    }
    throw new Error(`ElevenLabs no pudo generar la voz (HTTP ${response.status}).`);
  }

  const mp3 = Buffer.from(await response.arrayBuffer());
  if (!mp3.length || mp3.length > 8_000_000) {
    throw new Error("ElevenLabs devolvió un audio vacío o demasiado grande.");
  }

  // El renderizador trabaja con PCM mono a 24 kHz para medir y alinear cada frase.
  const ffmpeg = ffmpegStatic;
  if (!ffmpeg) throw new Error("FFmpeg no está disponible para convertir la narración.");

  const directory = await mkdtemp(path.join(tmpdir(), "elevenlabs-audio-"));
  try {
    const input = path.join(directory, "voice.mp3");
    const output = path.join(directory, "voice.pcm");
    await writeFile(input, mp3);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", input, "-f", "s16le", "-ar", "24000", "-ac", "1", output,
      ], { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => child.kill(), 30_000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error("No se pudo convertir el audio de ElevenLabs."));
      });
    });
    const pcm = await readFile(output);
    if (!pcm.length || pcm.length > 12_000_000) {
      throw new Error("La narración convertida no es válida.");
    }
    return pcm;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
