import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
const MAX_SECONDS = 60;
const FRAME_RATE = 24;

export type VideoAdStyle = "premium" | "dinamico" | "educativo";
export type CaptionFont = "arial" | "georgia" | "verdana" | "trebuchet";
const captionFamilies: Record<CaptionFont, string> = {
  arial: "Arial, sans-serif",
  georgia: "Georgia, serif",
  verdana: "Verdana, sans-serif",
  trebuchet: "Trebuchet MS, sans-serif",
};

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

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character] ?? character);
}

function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#116D60";
}

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
      throw new Error("La duración de cada escena debe estar entre 1 y 45 segundos.");
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

async function runFfmpeg(args: string[], timeoutMs = 180_000): Promise<void> {
  const binary = ffmpegStatic;
  if (!binary) throw new Error("FFmpeg no está disponible en el servidor.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"] as const,
    });
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
      else resolve();
    }

    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code === 0) finish();
      else finish(new Error("Falló el procesamiento de una escena."));
    });
  });
}

function sceneFilter(kind: AdScene["kind"], seconds: number, index: number, style: VideoAdStyle, isClosing: boolean): string {
  const source = kind === "image"
    ? `[0:v]${photoMotionFilter(index, style)},format=yuv420p[background];`
    : `[0:v]split=2[back][front];` +
      `[back]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=24:2,eq=brightness=-0.10[blur];` +
      `[front]scale=968:1460:force_original_aspect_ratio=decrease,setsar=1[subject];` +
      `[blur][subject]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FRAME_RATE},tpad=stop_mode=clone:stop_duration=${seconds},format=yuv420p[background];`;

  const captionFade = style === "dinamico" ? 0.18 : style === "educativo" ? 0.55 : 0.4;
  const captionDuration = Math.min(captionFade, seconds / 5);
  const captionStart = Math.max(0, seconds - captionDuration);

  const captions = isClosing
    ? "[1:v]format=rgba[captions];"
    : `[1:v]format=rgba,fade=t=in:st=0:d=${captionDuration}:alpha=1,` +
      `fade=t=out:st=${captionStart}:d=${captionDuration}:alpha=1[captions];`;

  return source + captions +
    `[background][captions]overlay=0:0:shortest=1,format=yuv420p[out]`;
}

export function photoMotionFilter(index: number, style: VideoAdStyle = "premium"): string {
  const speed = style === "dinamico" ? 0.0008 : style === "educativo" ? 0.00025 : 0.00045;
  const magnitude = style === "dinamico" ? 1.065 : style === "educativo" ? 1.022 : 1.04;
  const approach = index % 2 === 0;
  const zoom = approach
    ? `min(zoom+${speed},${magnitude})`
    : `if(eq(on,0),${magnitude},max(zoom-${speed},1.0))`;
  return `zoompan=z='${zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':` +
    `d=1:s=${WIDTH}x${HEIGHT}:fps=${FRAME_RATE},setsar=1`;
}

function wrapCaption(text: string, limit = 24): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > limit && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

async function captionOverlay(
  heading: string, brand: AdBrand, style: VideoAdStyle, index: number, total: number, font: CaptionFont,
): Promise<Buffer> {
  const isOpening = index === 0;
  const isClosing = index === total - 1;
  const accent = safeColor(brand.primaryColor);
  const hasLogo = brand.logoDataUrl?.startsWith("data:image/png;base64,") ?? false;
  const title = escapeXml(brand.clinicName.slice(0, hasLogo ? 25 : 33));
  const lines = wrapCaption(heading, style === "dinamico" ? 22 : 27);
  const baseSize = style === "dinamico" ? 77 : style === "educativo" ? 63 : 71;
  const fontSize = lines.length >= 4 ? Math.min(baseSize, 56) : lines.length === 3 ? Math.min(baseSize, 64) : baseSize;
  const lineHeight = fontSize + 19;
  const textTop = isClosing
    ? Math.min(1350, 1440 - (lines.length - 1) * lineHeight)
    : Math.min(1500, 1600 - (lines.length - 1) * lineHeight);
  const textNodes = lines.map((line, number) =>
    `<text x="96" y="${textTop + number * lineHeight}" font-size="${fontSize}" font-weight="700" fill="#fff" font-family="${captionFamilies[font]}">${escapeXml(line)}</text>`
  ).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#061916" stop-opacity=".63"/>
        <stop offset="28%" stop-color="#061916" stop-opacity="0"/>
        <stop offset="64%" stop-color="#061916" stop-opacity=".18"/>
        <stop offset="100%" stop-color="#061916" stop-opacity=".94"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/>
    <rect x="70" y="92" rx="22" width="940" height="100" fill="#061916" fill-opacity=".64"/>
    <rect x="88" y="111" rx="4" width="5" height="62" fill="${accent}"/>
    ${hasLogo ? '<rect x="108" y="102" rx="13" width="140" height="80" fill="#fff"/>' : ""}
    <text x="${hasLogo ? 268 : 120}" y="155" fill="white" font-size="${hasLogo ? 37 : 42}" font-weight="700" font-family="Arial, sans-serif">${title}</text>
    ${textNodes}
    <rect x="92" y="1837" width="896" height="3" fill="#fff" fill-opacity=".28"/>
    <text x="92" y="1878" fill="#fff" font-size="28" font-family="Arial, sans-serif" fill-opacity=".8">Contenido informativo · Valoración profesional</text>
  </svg>`);

  const layers: sharp.OverlayOptions[] = [{ input: svg }];
  if (isClosing) {
    const button = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="92">
      <rect width="600" height="92" rx="18" fill="#116D60"/>
      <text x="300" y="59" text-anchor="middle" fill="#FFFFFF" font-size="40"
        font-family="Arial, sans-serif" font-weight="700">Solicita tu valoración</text>
    </svg>`);
    layers.push({ input: await sharp(button).png().toBuffer(), left: 92, top: 1520 });
  }
  if (brand.logoDataUrl?.startsWith("data:image/png;base64,")) {
    const logoBytes = Buffer.from(brand.logoDataUrl.slice("data:image/png;base64,".length), "base64");
    if (logoBytes.length && logoBytes.length <= 500_000) {
      const logo = await sharp(logoBytes, { limitInputPixels: 8_000_000 })
        .resize({ width: 126, height: 68, fit: "inside" }).png().toBuffer();
      const logoSize = await sharp(logo).metadata();
      layers.push({
        input: logo,
        top: 108 + Math.round((68 - (logoSize.height ?? 68)) / 2),
        left: 115 + Math.round((126 - (logoSize.width ?? 126)) / 2),
      });
    }
  }
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#00000000" } })
    .composite(layers).png().toBuffer();
}

async function preparePhotoScene(bytes: Buffer): Promise<Buffer> {
  const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 }).metadata();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const ratio = width && height ? width / height : 1;

  if (ratio >= 0.49 && ratio <= 0.76) {
    return sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
      .rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
      .png().toBuffer();
  }

  const background = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
    .rotate().resize(WIDTH, HEIGHT, { fit: "cover" })
    .blur(28).modulate({ brightness: 0.84 }).png().toBuffer();

  const foreground = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
    .rotate().resize(1040, 1580, { fit: "inside", withoutEnlargement: false })
    .png().toBuffer();
  const dimensions = await sharp(foreground).metadata();
  const x = Math.round((WIDTH - (dimensions.width ?? 0)) / 2);
  const y = Math.round(820 - (dimensions.height ?? 0) / 2);

  return sharp(background)
    .composite([{ input: foreground, left: x, top: Math.max(205, y) }])
    .png().toBuffer();
}

export async function renderVideoAd(scenes: AdScene[], brand: AdBrand, style: VideoAdStyle = "premium", narration?: Buffer[], music?: { bytes: Buffer; extension: "mp3" | "wav" | "m4a"; volume: number }, captionFont: CaptionFont = "arial"): Promise<Buffer> {
  validateAdScenes(scenes);
  if (narration && narration.length !== scenes.length) {
    throw new Error("La narración no coincide con las escenas del anuncio.");
  }

  // Los clips de video siguen el ritmo de la voz; las fotografías conservan su duración.
  const timedScenes = scenes.map((scene, index) => {
    if (scene.kind !== "video" || !narration?.[index]) return scene;
    const voiceSeconds = narration[index].byteLength / (24000 * 2);
    const seconds = Math.min(scene.seconds, Math.max(1, Math.ceil(voiceSeconds + 0.6)));
    if (voiceSeconds > scene.seconds - 0.2) {
      throw new Error(`La narración de la escena ${index + 1} supera su duración. Acorta el subtítulo o amplía la escena.`);
    }
    return { ...scene, seconds };
  });
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
      await writeFile(overlay, await captionOverlay(scene.heading, brand, style, index, timedScenes.length, captionFont));

      const duration = String(scene.seconds);
      const videoFilter = sceneFilter(scene.kind, scene.seconds, index, style, index === timedScenes.length - 1);

      const inputs = scene.kind === "image"
        ? ["-loop", "1", "-framerate", String(FRAME_RATE), "-i", source]
        : ["-i", source];
      await runFfmpeg([
        ...inputs, "-loop", "1", "-framerate", String(FRAME_RATE), "-i", overlay,
        "-filter_complex", videoFilter, "-map", "[out]", "-an",
        "-t", duration, "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
        "-pix_fmt", "yuv420p", "-r", String(FRAME_RATE), "-movflags", "+faststart", output,
      ]);
      rendered.push(output);
    }

    const joined = path.join(directory, "advertisement.mp4");
    const transition = style === "dinamico" ? 0.2 : style === "educativo" ? 0.45 : 0.35;
    const filters = rendered.map((_, index) =>
      `[${index}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
    );
    let previous = "v0";
    let elapsed = timedScenes[0].seconds;

    for (let index = 1; index < rendered.length; index++) {
      const overlap = Math.min(transition, timedScenes[index - 1].seconds / 4, timedScenes[index].seconds / 4);
      const offset = Math.max(0, elapsed - overlap);
      const output = `mix${index}`;
      filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${overlap}:offset=${offset}[${output}]`);
      previous = output;
      elapsed = offset + timedScenes[index].seconds;
    }

    await runFfmpeg([
      ...rendered.flatMap(file => ["-i", file]),
      "-filter_complex", filters.join(";"),
      "-map", `[${previous}]`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", joined,
    ]);
    if (narration?.length || music?.bytes.length) {
      const output = path.join(directory, "advertisement-audio.mp4");
      const inputs = ["-i", joined];
      const filters: string[] = [];
      let nextInput = 1;

      if (narration?.length) {
        const voiceInputs: string[] = [];
        let position = 0;
        for (const [index, clip] of narration.entries()) {
          const pcmPath = path.join(directory, `narration-${index}.pcm`);
          await writeFile(pcmPath, clip);
          inputs.push("-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath);
          const sceneSeconds = timedScenes[index].seconds;
          const overlap = index === 0 ? 0 : Math.min(transition, timedScenes[index - 1].seconds / 4, sceneSeconds / 4);
          position += index === 0 ? 0 : timedScenes[index - 1].seconds - overlap;
          filters.push(`[${nextInput}:a]aresample=48000,atrim=duration=${Math.max(0.2, sceneSeconds - 0.2)},adelay=${Math.round(position * 1000)}:all=1[voice${index}]`);
          voiceInputs.push(`[voice${index}]`);
          nextInput++;
        }
        filters.push(`${voiceInputs.join("")}amix=inputs=${voiceInputs.length}:duration=longest:normalize=0,apad[voice]`);
      }

      if (music?.bytes.length) {
        const musicPath = path.join(directory, `music.${music.extension}`);
        await writeFile(musicPath, music.bytes);
        inputs.push("-stream_loop", "-1", "-i", musicPath);
        filters.push(`[${nextInput}:a]aresample=48000,volume=${music.volume},afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, elapsed - 1.5)}:d=1.5[music]`);
        if (narration?.length) {
          filters.push("[music][voice]sidechaincompress=threshold=0.025:ratio=8:attack=50:release=450[ducked]");
          filters.push("[ducked][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[audio]");
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
      return await readFile(output);
    }
    return await readFile(joined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
