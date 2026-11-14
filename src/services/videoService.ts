/**
 * Procesamiento local de videos clínicos cortos para Reels y TikTok.
 *
 * El recorte a 9:16 y los subtítulos se renderizan en este servidor con
 * ffmpeg. El archivo no se envía a una API externa de video.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { clinicalGuardrails } from "../config/clinicalGuardrails";

const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_DURATION_MS = 60_000;
const MAX_EDGE_PX = 4_096;
const MAX_TRANSCRIPT_WORDS = 400;
const VERTICAL_WIDTH = 1_080;
const VERTICAL_HEIGHT = 1_920;
const RENDER_TIMEOUT_MS = 120_000;

export type VideoServiceErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_VIDEO"
  | "INVALID_TRANSCRIPT"
  | "RENDER_FAILED";

export class VideoServiceError extends Error {
  readonly code: VideoServiceErrorCode;

  constructor(message: string, code: VideoServiceErrorCode) {
    super(message);
    this.name = "VideoServiceError";
    this.code = code;
  }
}

/** Palabra ya transcrita, con el instante en el que se escucha. */
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker: "doctor" | "patient";
}

interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
}

function assertVideoBytes(video: unknown): Uint8Array {
  if (!(video instanceof Uint8Array) || video.byteLength === 0) {
    throw new VideoServiceError(
      "El archivo de video está vacío o no es válido.",
      "INVALID_VIDEO",
    );
  }

  if (video.byteLength > MAX_VIDEO_BYTES) {
    throw new VideoServiceError(
      "El video supera el peso permitido de 80 MB.",
      "FILE_TOO_LARGE",
    );
  }

  return video;
}

function detectContainer(bytes: Uint8Array): "mp4" | "mov" | "webm" {
  if (bytes.byteLength < 12) {
    throw new VideoServiceError(
      "El archivo de video está incompleto o corrupto.",
      "INVALID_VIDEO",
    );
  }

  const isWebm =
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3;

  if (isWebm) {
    const head = Buffer.from(
      bytes.subarray(0, Math.min(bytes.byteLength, 4096)),
    ).toString("latin1");

    if (!head.includes("webm")) {
      throw new VideoServiceError(
        "El formato del video no es compatible. Usa MP4, MOV o WebM.",
        "UNSUPPORTED_FORMAT",
      );
    }

    return "webm";
  }

  const box = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
  if (box !== "ftyp") {
    throw new VideoServiceError(
      "El formato del video no es compatible. Usa MP4, MOV o WebM.",
      "UNSUPPORTED_FORMAT",
    );
  }

  const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
  if (brand === "qt  ") {
    return "mov";
  }

  return "mp4";
}

function resolveFfmpegPath(): string {
  if (typeof ffmpegStatic !== "string" || ffmpegStatic.length === 0) {
    throw new VideoServiceError(
      "No está disponible el motor de video en este servidor.",
      "RENDER_FAILED",
    );
  }

  return ffmpegStatic;
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const binary = resolveFfmpegPath();

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      fail(
        new VideoServiceError(
          "El procesamiento del video tardó demasiado.",
          "RENDER_FAILED",
        ),
      );
    }, RENDER_TIMEOUT_MS);

    function fail(error: VideoServiceError) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", () => {
      fail(
        new VideoServiceError(
          "No se pudo iniciar el motor de video.",
          "RENDER_FAILED",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parseProbe(stderr: string): VideoProbe {
  const duration = /Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const video = /Video:\s+.+?,\s+(\d{2,5})x(\d{2,5})/.exec(stderr);

  if (!duration || !video) {
    throw new VideoServiceError(
      "El archivo no contiene un video que se pueda leer.",
      "INVALID_VIDEO",
    );
  }

  const hours = Number(duration[1]);
  const minutes = Number(duration[2]);
  const seconds = Number(duration[3]);
  const width = Number(video[1]);
  const height = Number(video[2]);
  const durationMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new VideoServiceError(
      "No se pudo leer la duración del video.",
      "INVALID_VIDEO",
    );
  }

  if (durationMs > MAX_DURATION_MS) {
    throw new VideoServiceError(
      "El video supera los 60 segundos permitidos para un Reel.",
      "INVALID_VIDEO",
    );
  }

  if (
    width < 2 ||
    height < 2 ||
    width > MAX_EDGE_PX ||
    height > MAX_EDGE_PX
  ) {
    throw new VideoServiceError(
      "La resolución del video no es compatible.",
      "INVALID_VIDEO",
    );
  }

  return { width, height, durationMs };
}

async function probeVideo(filePath: string): Promise<VideoProbe> {
  const result = await runFfmpeg(["-hide_banner", "-i", filePath]);
  try {
    return parseProbe(result.stderr);
  } catch (error) {
    if (error instanceof VideoServiceError) {
      throw error;
    }

    throw new VideoServiceError(
      "El archivo de video está corrupto o no se puede leer.",
      "INVALID_VIDEO",
    );
  }
}

function failureFromFfmpeg(stderr: string, fallback: string): VideoServiceError {
  if (/invalid data|moov atom not found|invalid argument/i.test(stderr)) {
    return new VideoServiceError(
      "El archivo de video está corrupto o no se puede leer.",
      "INVALID_VIDEO",
    );
  }

  return new VideoServiceError(fallback, "RENDER_FAILED");
}

async function withTempDir<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "clinical-video-"));

  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function renderToMp4(
  inputPath: string,
  outputPath: string,
  videoFilter: string,
  fallback: string,
): Promise<Uint8Array> {
  const result = await runFfmpeg([
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  if (result.code !== 0) {
    throw failureFromFfmpeg(result.stderr, fallback);
  }

  const rendered = await readFile(outputPath);
  if (rendered.byteLength === 0) {
    throw new VideoServiceError(fallback, "RENDER_FAILED");
  }

  return new Uint8Array(rendered);
}

/**
 * Recorta el video al centro y lo exporta en vertical 9:16 (1080×1920).
 *
 * @throws {VideoServiceError} FILE_TOO_LARGE, UNSUPPORTED_FORMAT, INVALID_VIDEO o RENDER_FAILED.
 */
export async function renderVerticalClinicalVideo(
  video: Uint8Array,
): Promise<Uint8Array> {
  const bytes = assertVideoBytes(video);
  const extension = detectContainer(bytes);

  return withTempDir(async (directory) => {
    const inputPath = path.join(directory, `source.${extension}`);
    const outputPath = path.join(directory, "vertical.mp4");
    await writeFile(inputPath, bytes);
    await probeVideo(inputPath);

    return renderToMp4(
      inputPath,
      outputPath,
      `scale=${VERTICAL_WIDTH}:${VERTICAL_HEIGHT}:force_original_aspect_ratio=increase,crop=${VERTICAL_WIDTH}:${VERTICAL_HEIGHT}`,
      "No se pudo recortar el video a formato vertical.",
    );
  });
}

function assertTranscript(transcript: readonly TranscriptWord[]): TranscriptWord[] {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new VideoServiceError(
      "La transcripción del video es obligatoria.",
      "INVALID_TRANSCRIPT",
    );
  }

  if (transcript.length > MAX_TRANSCRIPT_WORDS) {
    throw new VideoServiceError(
      "La transcripción supera las 400 palabras permitidas para un video corto.",
      "INVALID_TRANSCRIPT",
    );
  }

  const words = transcript.map((word, index) => {
    if (typeof word?.text !== "string" || word.text.trim().length === 0) {
      throw new VideoServiceError(
        `La palabra ${index + 1} de la transcripción está vacía.`,
        "INVALID_TRANSCRIPT",
      );
    }

    if (word.speaker !== "doctor" && word.speaker !== "patient") {
      throw new VideoServiceError(
        "Cada palabra debe indicar si la dice el doctor o el paciente.",
        "INVALID_TRANSCRIPT",
      );
    }

    if (
      !Number.isFinite(word.startMs) ||
      !Number.isFinite(word.endMs) ||
      word.startMs < 0 ||
      word.endMs <= word.startMs
    ) {
      throw new VideoServiceError(
        "Cada palabra de la transcripción necesita un inicio y un fin válidos.",
        "INVALID_TRANSCRIPT",
      );
    }

    return {
      text: word.text.trim(),
      startMs: word.startMs,
      endMs: word.endMs,
      speaker: word.speaker,
    };
  });

  clinicalGuardrails.validate(words.map((word) => word.text).join(" "));
  return words.sort((left, right) => left.startMs - right.startMs);
}

function escapeAss(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\n", " ");
}

function assTime(ms: number): string {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const remainder = centiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(2, "0")}`;
}

function groupTranscript(words: readonly TranscriptWord[]): TranscriptWord[][] {
  const lines: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length > 0) {
      lines.push(current);
      current = [];
    }
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const lineText = current.map((item) => item.text).join(" ");
    const speakerChanged = previous !== undefined && previous.speaker !== word.speaker;
    const longPause = previous !== undefined && word.startMs - previous.endMs > 700;
    const lineFull = lineText.length + word.text.length > 42 || current.length >= 5;

    if (speakerChanged || longPause || lineFull) {
      flush();
    }

    current.push(word);
  }

  flush();
  return lines;
}

function buildKaraokeAss(
  words: readonly TranscriptWord[],
  frame: VideoProbe,
): string {
  const fontSize = Math.max(28, Math.round(frame.height * 0.034));
  const marginV = Math.round(frame.height * 0.12);
  const lines = groupTranscript(words);
  const events = lines.map((line) => {
    const karaoke = line
      .map((word) => {
        const duration = Math.max(1, Math.round((word.endMs - word.startMs) / 10));
        return `{\\kf${duration}}${escapeAss(word.text)}`;
      })
      .join(" ");
    const style = line[0]?.speaker === "patient" ? "Patient" : "Doctor";

    return `Dialogue: 0,${assTime(line[0].startMs)},${assTime(line[line.length - 1].endMs)},${style},,0,0,0,,${karaoke}`;
  });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Doctor,Arial,${fontSize},&H006E760F,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,${marginV},1`,
    `Style: Patient,Arial,${fontSize},&H0074A5C4,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

function escapeFilterPath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll(",", "\\,")
    .replaceAll("'", "\\'");
}

/**
 * Quema subtítulos karaoke sobre el video.
 * Cada palabra se destaca mientras suena, con un color para el doctor y otro para el paciente.
 * El texto se toma de la transcripción recibida y se valida contra los guardrails clínicos.
 *
 * @throws {VideoServiceError} FILE_TOO_LARGE, UNSUPPORTED_FORMAT, INVALID_VIDEO, INVALID_TRANSCRIPT o RENDER_FAILED.
 * @throws {ClinicalGuardrailWarning} si la transcripción contiene una frase prohibida.
 */
export async function overlayKaraokeSubtitles(
  video: Uint8Array,
  transcript: readonly TranscriptWord[],
): Promise<Uint8Array> {
  const bytes = assertVideoBytes(video);
  const extension = detectContainer(bytes);
  const words = assertTranscript(transcript);

  return withTempDir(async (directory) => {
    const inputPath = path.join(directory, `source.${extension}`);
    const captionPath = path.join(directory, "captions.ass");
    const outputPath = path.join(directory, "captioned.mp4");
    await writeFile(inputPath, bytes);
    const frame = await probeVideo(inputPath);
    const lastWord = words[words.length - 1];

    if (lastWord.endMs > frame.durationMs + 250) {
      throw new VideoServiceError(
        "La transcripción termina después de que acaba el video.",
        "INVALID_TRANSCRIPT",
      );
    }

    await writeFile(captionPath, buildKaraokeAss(words, frame), "utf8");
    const fontsDir =
      process.platform === "win32"
        ? `:fontsdir='${escapeFilterPath("C:/Windows/Fonts")}'`
        : "";
    const subtitleFilter = `subtitles='${escapeFilterPath(captionPath)}'${fontsDir}`;

    return renderToMp4(
      inputPath,
      outputPath,
      subtitleFilter,
      "No se pudieron superponer los subtítulos del video.",
    );
  });
}

/** Elimina todas las pistas de audio del MP4 final sin modificar la imagen. */
export async function muteClinicalVideo(video: Uint8Array): Promise<Uint8Array> {
  const bytes = assertVideoBytes(video);
  const extension = detectContainer(bytes);

  return withTempDir(async (directory) => {
    const source = path.join(directory, `input.${extension}`);
    const destination = path.join(directory, "silent.mp4");
    await writeFile(source, bytes);
    await probeVideo(source);

    const output = await runFfmpeg([
      "-y", "-hide_banner", "-i", source,
      "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", destination,
    ]);
    if (output.code !== 0) {
      throw failureFromFfmpeg(output.stderr, "No se pudo quitar el audio del video.");
    }
    const silent = await readFile(destination);
    if (!silent.byteLength) throw new VideoServiceError("El video sin audio quedó vacío.", "RENDER_FAILED");
    return new Uint8Array(silent);
  });
}

export async function renderPhotoReel(image: Uint8Array, seconds = 7): Promise<Uint8Array> {
  if (image.byteLength === 0 || image.byteLength > 20 * 1024 * 1024) {
    throw new VideoServiceError("La fotografía supera el tamaño permitido o está vacía.", "INVALID_VIDEO");
  }
  if (seconds < 3 || seconds > 15) {
    throw new VideoServiceError("El Reel fotográfico debe durar entre 3 y 15 segundos.", "INVALID_VIDEO");
  }
  return withTempDir(async (directory) => {
    const source = path.join(directory, "photo.png");
    const destination = path.join(directory, "photo-reel.mp4");
    await writeFile(source, image);
    const rendered = await runFfmpeg([
      "-y", "-hide_banner", "-loop", "1", "-framerate", "30", "-i", source,
      "-t", String(seconds),
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-r", "30", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", destination,
    ]);
    if (rendered.code !== 0) throw failureFromFfmpeg(rendered.stderr, "No se pudo convertir la imagen en Reel.");
    const bytes = await readFile(destination);
    if (!bytes.byteLength) throw new VideoServiceError("El Reel generado está vacío.", "RENDER_FAILED");
    return new Uint8Array(bytes);
  });
}

/**
 * Incrusta el logotipo durante todo el video sin alterar el original.
 * Se aplica después de los subtítulos para conservar su legibilidad.
 */
export async function overlayVideoLogo(
  video: Uint8Array,
  logoDataUrl: string | null | undefined,
): Promise<Uint8Array> {
  if (!logoDataUrl?.startsWith("data:image/png;base64,")) return video;
  const bytes = assertVideoBytes(video);
  const extension = detectContainer(bytes);
  const logoSource = Buffer.from(logoDataUrl.slice("data:image/png;base64,".length), "base64");

  let logo: Buffer;
  try {
    logo = await sharp(logoSource, { failOn: "error", limitInputPixels: 8_000_000 })
      .resize({ width: 310, height: 150, fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
  } catch {
    throw new VideoServiceError("El logotipo configurado no se puede procesar.", "RENDER_FAILED");
  }

  return withTempDir(async (directory) => {
    const inputPath = path.join(directory, `source.${extension}`);
    const logoPath = path.join(directory, "watermark.png");
    const outputPath = path.join(directory, "branded.mp4");
    await Promise.all([writeFile(inputPath, bytes), writeFile(logoPath, logo)]);
    await probeVideo(inputPath);

    const rendered = await runFfmpeg([
      "-y", "-hide_banner",
      "-i", inputPath,
      "-loop", "1", "-i", logoPath,
      "-filter_complex", "[0:v:0][1:v:0]overlay=x=W-w-42:y=H-h-420:shortest=1[v]",
      "-map", "[v]",
      "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-shortest", outputPath,
    ]);
    if (rendered.code !== 0) {
      throw failureFromFfmpeg(rendered.stderr, "No se pudo incrustar el logotipo en el video.");
    }
    const finalVideo = await readFile(outputPath);
    if (!finalVideo.length) {
      throw new VideoServiceError("El video con marca de agua quedó vacío.", "RENDER_FAILED");
    }
    return new Uint8Array(finalVideo);
  });
}
