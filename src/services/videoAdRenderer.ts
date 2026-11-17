import { AD_CANVAS, clinicalLayout, composeAdOverlay, layoutAdCaption, validateClosingCopy } from "./videoAdLayout";
import { validateCommercialText } from "./videoAdCopy";
import { planAdTimeline, type NarrationTrack } from "./videoAdTimeline";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";

const WIDTH = 1080;
const HEIGHT = 1920;
const adLabels = {
  "es-CO": { cta: "Hablemos por WhatsApp." },
  "en-US": { cta: "Message us on WhatsApp." },
};
export type AdLanguage = keyof typeof adLabels;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
const MAX_SECONDS = 60;
const FRAME_RATE = 24;

export type VideoAdStyle = "premium" | "dinamico" | "educativo";
export type CaptionFont = "arial" | "georgia" | "verdana" | "trebuchet";

export type AdScene = {
  filename: string;
  bytes: Buffer;
  kind: "image" | "video";
  seconds: number;
  heading: string;
};

export type AdBrand = {
  clinicName: string;
  primaryColor: string;
  logoDataUrl: string | null;
};

export function validateAdScenes(scenes: AdScene[]): void {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > MAX_FILES) {
    throw new Error("Agrega entre 1 y 12 escenas.");
  }

  let bytes = 0;
  let seconds = 0;
  for (const scene of scenes) {
    if (!["image", "video"].includes(scene.kind) || !Buffer.isBuffer(scene.bytes) ||
        !scene.bytes.length || scene.bytes.length > MAX_FILE_BYTES) {
      throw new Error("Uno de los archivos multimedia no es válido o supera 80 MB.");
    }
    if (!Number.isInteger(scene.seconds) || scene.seconds < 1 || scene.seconds > MAX_SECONDS) {
      throw new Error("La duración de cada escena debe estar entre 1 y 60 segundos.");
    }
    if (typeof scene.heading !== "string" || scene.heading.length > 180 ||
        typeof scene.filename !== "string" || scene.filename.length > 180) {
      throw new Error("El texto o el nombre del archivo es demasiado largo.");
    }
    bytes += scene.bytes.length;
    seconds += scene.seconds;
  }
  if (bytes > MAX_TOTAL_BYTES || seconds > MAX_SECONDS) {
    throw new Error("El anuncio no puede superar 120 MB de archivos ni 60 segundos.");
  }
}

function mediaExtension(bytes: Buffer): "jpg" | "png" | "webp" | "mp4" | "mov" | "webm" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.toString("hex", 0, 4) === "1a45dfa3") return "webm";
  if (bytes.toString("ascii", 4, 8) === "ftyp") return bytes.toString("ascii", 8, 12) === "qt  " ? "mov" : "mp4";
  return null;
}

async function runFfmpeg(args: string[], timeoutMs = 180_000): Promise<{ stdout: string; stderr: string }> {
  const binary = ffmpegStatic;
  if (!binary) throw new Error("FFmpeg no está disponible en el servidor.");

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout = (stdout + data.toString()).slice(-1000000); });
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-1000000); });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("FFmpeg excedió el tiempo de procesamiento."));
    }, timeoutMs);

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    }

    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code === 0) finish();
      else finish(new Error("Falló el procesamiento de una escena."));
    });
  });
}

function sceneFilter(kind: AdScene["kind"], seconds: number, index: number, style: VideoAdStyle, isClosing: boolean, layout: ReturnType<typeof clinicalLayout>): string {
  // Fit the entire clinical source, without zoom, crop, retouching or a blurred duplicate.
  const source = kind === "image"
    ? `[0:v]setsar=1,format=yuv420p[background];`
    : `[0:v]setpts=PTS-STARTPTS,scale=${layout.width}:${layout.height}:force_original_aspect_ratio=decrease,setsar=1,` +
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:${layout.top}:color=0xf5f3ee,fps=${FRAME_RATE},` +
      `tpad=stop_mode=clone:stop_duration=${seconds},format=yuv420p[background];`;
  return source + "[1:v]format=rgba[captions];" +
    "[background][captions]overlay=0:0:shortest=1,format=yuv420p[out]";
}

// Kept as a public helper for callers; clinical photographs remain stationary.
export function photoMotionFilter(index: number, style: VideoAdStyle = "premium"): string {
  return `fps=${FRAME_RATE},setsar=1`;
}

export async function preparePhotoScene(bytes: Buffer): Promise<Buffer> {
  const oriented = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 }).rotate().toBuffer({ resolveWithObject: true });
  const layout = clinicalLayout(oriented.info.width, oriented.info.height);
  const foreground = await sharp(oriented.data).resize(layout.width, layout.height, { fit: "inside" }).png().toBuffer();
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: AD_CANVAS.background } })
    .composite([{ input: foreground, left: layout.left, top: layout.top }]).png().toBuffer();
}

export async function renderVideoAd(scenes: AdScene[], brand: AdBrand, style: VideoAdStyle = "premium", narration?: NarrationTrack, music?: { bytes: Buffer; extension: "mp3" | "wav" | "m4a"; volume: number }, captionFont: CaptionFont = "arial", closing?: { text?: string; whatsapp?: string }, language: AdLanguage = "es-CO", targetSeconds?: number): Promise<Buffer> {
  validateAdScenes(scenes);
  for (const scene of scenes) {
    validateCommercialText(scene.heading, language);
    await layoutAdCaption(scene.heading, captionFont);
  }
  if (closing) {
    validateClosingCopy(closing.text ?? adLabels[language].cta, closing.whatsapp);
    await layoutAdCaption(closing.text ?? adLabels[language].cta, captionFont, 76);
  }
  const weights = [...scenes.map(scene => scene.seconds), ...(closing ? [6] : [])];
  const expectedSeconds = targetSeconds ?? weights.reduce((a, b) => a + b, 0);
  const readingTimes = [...scenes.map(scene => Math.max(2, scene.heading.trim().split(/\s+/).length / 2.5)), ...(closing ? [Math.max(3, (closing.text ?? adLabels[language].cta).trim().split(/\s+/).length / 2.5)] : [])];
  const plan = planAdTimeline(weights, expectedSeconds, narration, readingTimes);
  const durations = plan.durations;
  narration = plan.narration;
  const timedScenes = scenes.map((scene, index) => ({ ...scene, seconds: durations?.[index] ?? scene.seconds }));
  const closingSeconds = closing ? (durations?.[scenes.length] ?? 6) : 0;
  if (timedScenes.reduce((total, scene) => total + scene.seconds, 0) + closingSeconds > MAX_SECONDS + 1 / FRAME_RATE) {
    throw new Error("El anuncio completo, incluido el cierre, no puede superar 60 segundos.");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "dental-video-ad-"));

  try {
    const rendered: string[] = [];
    for (const [index, scene] of timedScenes.entries()) {
      const extension = mediaExtension(scene.bytes);
      if (!extension || (scene.kind === "image" && !["jpg", "png", "webp"].includes(extension)) ||
          (scene.kind === "video" && !["mp4", "mov", "webm"].includes(extension))) {
        throw new Error("El contenido del archivo no coincide con un formato multimedia admitido.");
      }

      const source = path.join(directory, `source-${index}.${scene.kind === "image" ? "png" : extension}`);
      const overlay = path.join(directory, `overlay-${index}.png`);
      const output = path.join(directory, `scene-${index}.mp4`);
      await writeFile(source, scene.kind === "image" ? await preparePhotoScene(scene.bytes) : scene.bytes);
      // Read the oriented source dimensions so captions follow the actual picture,
      // including landscape clips, instead of leaving a fixed empty subtitle band.
      let dimensions;
      if (scene.kind === "image") {
        dimensions = (await sharp(scene.bytes, { limitInputPixels: 30_000_000 }).rotate().toBuffer({ resolveWithObject: true })).info;
      } else {
        const preview = path.join(directory, `dimensions-${index}.png`);
        await runFfmpeg(["-i", source, "-frames:v", "1", "-vf", "scale=1080:1380:force_original_aspect_ratio=decrease,setsar=1", preview]);
        dimensions = await sharp(preview).metadata();
      }
      const layout = clinicalLayout(dimensions.width!, dimensions.height!);
      await writeFile(overlay, await composeAdOverlay(scene.heading, brand, captionFont, layout.captionTop));

      const videoFilter = sceneFilter(scene.kind, scene.seconds, index, style, index === timedScenes.length - 1, layout);

      const inputs = scene.kind === "image"
        ? ["-loop", "1", "-framerate", String(FRAME_RATE), "-i", source]
        : ["-i", source];
      await runFfmpeg([
        ...inputs, "-loop", "1", "-framerate", String(FRAME_RATE), "-i", overlay,
        "-filter_complex", videoFilter, "-map", "[out]", "-an",
        "-frames:v", String(Math.round(scene.seconds * FRAME_RATE)), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", String(FRAME_RATE), "-movflags", "+faststart", output,
      ]);
      rendered.push(output);
    }

    if (closing) {
      const closingPath = path.join(directory, "closing.png");
      const closingVideo = path.join(directory, "closing.mp4");
      await writeFile(closingPath, await composeAdOverlay(closing.text ?? adLabels[language].cta, brand, captionFont, 980, true, closing.whatsapp));
      await runFfmpeg(["-loop", "1", "-framerate", String(FRAME_RATE), "-i", closingPath,
        "-frames:v", String(Math.round(closingSeconds * FRAME_RATE)), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", String(FRAME_RATE), closingVideo]);
      rendered.push(closingVideo);
      timedScenes.push({ filename: "closing.png", bytes: Buffer.from([1]), kind: "image", seconds: closingSeconds, heading: "" });
    }

    const joined = path.join(directory, "advertisement.mp4");
    // Cuts retain every planned frame; overlapping fades shorten the selected duration.
    const filters = rendered.map((_, index) =>
      `[${index}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
    );
    const previous = "joined";
    const elapsed = timedScenes.reduce((sum, scene) => sum + scene.seconds, 0);
    filters.push(rendered.map((_, index) => `[v${index}]`).join("") +
      `concat=n=${rendered.length}:v=1:a=0[${previous}]`);

    await runFfmpeg([
      ...rendered.flatMap(file => ["-i", file]),
      "-filter_complex", filters.join(";"),
      "-map", `[${previous}]`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", joined,
    ]);
    if (narration?.pcm.length || music?.bytes.length) {
      const output = path.join(directory, "advertisement-audio.mp4");
      const inputs = ["-i", joined];
      const filters: string[] = [];
      let nextInput = 1;

      if (narration?.pcm.length) {
        const pcmPath = path.join(directory, "narration.pcm");
        await writeFile(pcmPath, narration.pcm);
        inputs.push("-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath);
        filters.push(`[${nextInput}:a]aresample=48000,apad=pad_dur=0.05[voice]`);
        nextInput++;
      }

      if (music?.bytes.length) {
        const musicPath = path.join(directory, `music.${music.extension}`);
        await writeFile(musicPath, music.bytes);
        inputs.push("-stream_loop", "-1", "-i", musicPath);
        filters.push(`[${nextInput}:a]aresample=48000,volume=${music.volume},afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, elapsed - 1.5)}:d=1.5[music]`);
        if (narration?.pcm.length) {
          filters.push("[voice]asplit=2[sidechain][narration]");
          filters.push("[music][sidechain]sidechaincompress=threshold=0.025:ratio=8:attack=50:release=450[ducked]");
          filters.push("[ducked][narration]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[audio]");
        } else {
          filters.push("[music]alimiter=limit=0.95[audio]");
        }
      } else {
        filters.push("[voice]anull[audio]");
      }

      await runFfmpeg([
        ...inputs, "-filter_complex", filters.join(";"),
        "-map", "0:v:0", "-map", "[audio]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-t", String(elapsed),
        "-movflags", "+faststart", output,
      ]);
      await verifyRenderedAd(output, expectedSeconds);
      return await readFile(output);
    }
    await verifyRenderedAd(joined, expectedSeconds);
    return await readFile(joined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}


export async function verifyRenderedAd(filename: string, expectedSeconds: number) {
  const result = await runFfmpeg(["-loglevel", "info", "-i", filename, "-map", "0:v:0", "-an", "-progress", "pipe:1", "-f", "null", "-"], 120000);
  const frames = Number([...result.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
  const seconds = Number([...result.stdout.matchAll(/^out_time_us=(\d+)/gm)].at(-1)?.[1]) / 1000000 + 1 / FRAME_RATE;
  const container = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr);
  const containerSeconds = container ? Number(container[1]) * 3600 + Number(container[2]) * 60 + Number(container[3]) : NaN;
  if (!Number.isFinite(containerSeconds) || Math.abs(containerSeconds - expectedSeconds) > 0.05 || frames !== Math.round(expectedSeconds * FRAME_RATE) || !Number.isFinite(seconds) || Math.abs(seconds - expectedSeconds) > 0.001 || !/1080x1920/.test(result.stderr)) {
    throw new Error(`El MP4 exportado no cumple la duración solicitada (${expectedSeconds} s) o el formato vertical. No se entregará este archivo.`);
  }
  return { frames, seconds };
}
