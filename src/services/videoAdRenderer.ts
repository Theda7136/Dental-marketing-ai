import { narrationDurations, type NarrationTrack } from "./videoAdTimeline";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";

const WIDTH = 1080;
const HEIGHT = 1920;
const adLabels = {
  "es-CO": { footer: "Información · Valoración profesional", contact: "Agenda tu valoración", cta: "Conoce tus opciones. Escríbenos por WhatsApp." },
  "en-US": { footer: "Information · Professional consultation", contact: "Book a consultation", cta: "Explore your options. Message us on WhatsApp." },
};
export type AdLanguage = keyof typeof adLabels;
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

async function runFfmpeg(args: string[], timeoutMs = 180_000): Promise<void> {
  const binary = ffmpegStatic;
  if (!binary) throw new Error("FFmpeg no está disponible en el servidor.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"] as const,
    });
    child.stderr.resume();
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
  // Fit the entire clinical source, without zoom, crop, retouching or a blurred duplicate.
  const source = kind === "image"
    ? `[0:v]setsar=1,format=yuv420p[background];`
    : `[0:v]scale=${WIDTH}:1260:force_original_aspect_ratio=decrease,setsar=1,` +
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:210+(1260-ih)/2:color=0x081e1b,fps=${FRAME_RATE},` +
      `tpad=stop_mode=clone:stop_duration=${seconds},format=yuv420p[background];`;
  return source + "[1:v]format=rgba[captions];" +
    "[background][captions]overlay=0:0:shortest=1,format=yuv420p[out]";
}

// Kept as a public helper for callers; clinical photographs remain stationary.
export function photoMotionFilter(index: number, style: VideoAdStyle = "premium"): string {
  return `fps=${FRAME_RATE},setsar=1`;
}

function wrapCaption(text: string, limit = 24): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").flatMap(word => word.match(new RegExp(`.{1,${limit}}`, "gu")) ?? []);
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
  return lines;
}

async function captionOverlay(
  heading: string, brand: AdBrand, style: VideoAdStyle, index: number, total: number, font: CaptionFont, language: AdLanguage,
): Promise<Buffer> {
  const accent = safeColor(brand.primaryColor);
  const hasLogo = brand.logoDataUrl?.startsWith("data:image/png;base64,") ?? false;
  const title = escapeXml(brand.clinicName.slice(0, hasLogo ? 25 : 33));
  const lines = wrapCaption(heading, 34);
  const baseSize = style === "dinamico" ? 68 : style === "educativo" ? 58 : 64;
  const fontSize = Math.max(26, Math.min(baseSize, Math.floor(860 / (Math.max(...lines.map(line => line.length), 1) * 0.7)), Math.floor(250 / Math.max(1, lines.length)) - 8));
  const lineHeight = fontSize + 8;
  const textBottom = 1720;
  const textTop = textBottom - (lines.length - 1) * lineHeight;
  const textNodes = lines.map((line, number) => {
    const estimatedWidth = line.length * fontSize * 0.62;
    const width = Math.min(860, Math.max(1, Math.round(estimatedWidth)));
    return `<text x="96" y="${textTop + number * lineHeight}" font-size="${fontSize}" font-weight="700" fill="#fff" font-family="${captionFamilies[font]}" textLength="${width}" lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="0" y="1480" width="${WIDTH}" height="440" fill="#081e1b"/>
    <rect x="70" y="92" rx="22" width="940" height="100" fill="#061916" fill-opacity=".64"/>
    <rect x="88" y="111" rx="4" width="5" height="62" fill="${accent}"/>
    ${hasLogo ? '<rect x="108" y="102" rx="13" width="140" height="80" fill="#fff"/>' : ""}
    <text x="${hasLogo ? 268 : 120}" y="155" fill="white" font-size="${hasLogo ? 37 : 42}" font-weight="700" font-family="Arial, sans-serif">${title}</text>
    ${textNodes}
    <rect x="92" y="1837" width="896" height="3" fill="#fff" fill-opacity=".28"/>
    <text x="92" y="1878" fill="#fff" font-size="28" font-family="Arial, sans-serif" fill-opacity=".8">${adLabels[language].footer}</text>
  </svg>`);

  const layers: sharp.OverlayOptions[] = [{ input: svg }];
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

export async function preparePhotoScene(bytes: Buffer): Promise<Buffer> {
  const foreground = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
    .rotate().resize(WIDTH, 1260, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const dimensions = await sharp(foreground).metadata();
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#081e1b" } })
    .composite([{ input: foreground, left: Math.round((WIDTH - dimensions.width!) / 2),
      top: 210 + Math.round((1260 - dimensions.height!) / 2) }]).png().toBuffer();
}

export async function renderVideoAd(scenes: AdScene[], brand: AdBrand, style: VideoAdStyle = "premium", narration?: NarrationTrack, music?: { bytes: Buffer; extension: "mp3" | "wav" | "m4a"; volume: number }, captionFont: CaptionFont = "arial", closing?: { text?: string; whatsapp?: string }, language: AdLanguage = "es-CO"): Promise<Buffer> {
  validateAdScenes(scenes);
  const durations = narration ? narrationDurations(narration, scenes.length + (closing ? 1 : 0)) : undefined;
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
      await writeFile(overlay, await captionOverlay(scene.heading, brand, style, index, timedScenes.length, captionFont, language));

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

    if (closing) {
      const closingPath = path.join(directory, "closing.png");
      const closingVideo = path.join(directory, "closing.mp4");
      const accent = safeColor(brand.primaryColor);
      const clinic = escapeXml(brand.clinicName.slice(0, 40));
      const contact = closing.whatsapp ? escapeXml(closing.whatsapp) : adLabels[language].contact;
      const callToAction = (closing.text ?? adLabels[language].cta).trim();
      const headlineLines = wrapCaption(callToAction, 25);
      const headlineSize = Math.min(headlineLines.length > 5 ? 48 : 60, Math.floor(880 / (Math.max(...headlineLines.map(line => line.length), 1) * 0.8)));
      const headlineSvg = headlineLines.map((line, index) => `<text x="100" y="${700 + index * 78}" fill="#ffffff" font-size="${headlineSize}" font-weight="500" font-family="${captionFamilies[captionFont]}">${escapeXml(line)}</text>`).join("");
      const closingSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
        <rect width="1080" height="1920" fill="#081e1b"/>
        <rect x="0" y="0" width="1080" height="18" fill="${accent}"/>
        <path d="M100 550 H300" stroke="${accent}" stroke-width="6"/>
        <text x="540" y="340" text-anchor="middle" fill="#c5ded8" font-size="40" font-family="Arial, sans-serif">${clinic}</text>
        ${headlineSvg}
        <path d="M100 1390 H980" stroke="#c5ded8" stroke-opacity=".35"/>
        <text x="100" y="1470" fill="#d4e8e2" font-size="36" font-family="Arial, sans-serif">${contact}</text>
        <text x="100" y="1790" fill="#c5ded8" font-size="26" font-family="Arial, sans-serif">${adLabels[language].footer}</text>
      </svg>`);
      const closingLayers: sharp.OverlayOptions[] = [{ input: closingSvg }];
      if (brand.logoDataUrl?.startsWith("data:image/png;base64,")) {
        const logoBytes = Buffer.from(brand.logoDataUrl.slice("data:image/png;base64,".length), "base64");
        if (logoBytes.length && logoBytes.length <= 500_000) {
          const logo = await sharp(logoBytes).resize({ width: 220, height: 120, fit: "inside" }).png().toBuffer();
          closingLayers.push({ input: logo, top: 135, left: 430 });
        }
      }
      await writeFile(closingPath, await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#081e1b" } }).composite(closingLayers).png().toBuffer());
      await runFfmpeg(["-loop", "1", "-framerate", String(FRAME_RATE), "-i", closingPath,
        "-t", String(closingSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
        "-pix_fmt", "yuv420p", "-r", String(FRAME_RATE), closingVideo]);
      rendered.push(closingVideo);
      timedScenes.push({ filename: "closing.png", bytes: Buffer.from([1]), kind: "image", seconds: closingSeconds, heading: "" });
    }

    const joined = path.join(directory, "advertisement.mp4");
    const transition = style === "dinamico" ? 0.2 : style === "educativo" ? 0.45 : 0.35;
    const filters = rendered.map((_, index) =>
      `[${index}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
    );
    let previous = "v0";
    let elapsed = timedScenes[0].seconds;

    for (let index = 1; index < rendered.length; index++) {
      const overlap = narration ? 0 : Math.min(transition, timedScenes[index - 1].seconds / 4, timedScenes[index].seconds / 4);
      const offset = Math.max(0, elapsed - overlap);
      const output = `mix${index}`;
      filters.push(narration
        ? `[${previous}][v${index}]concat=n=2:v=1:a=0[${output}]`
        : `[${previous}][v${index}]xfade=transition=fade:duration=${overlap}:offset=${offset}[${output}]`);
      previous = output;
      elapsed = offset + timedScenes[index].seconds;
    }

    await runFfmpeg([
      ...rendered.flatMap(file => ["-i", file]),
      "-filter_complex", filters.join(";"),
      "-map", `[${previous}]`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
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
      return await readFile(output);
    }
    return await readFile(joined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
