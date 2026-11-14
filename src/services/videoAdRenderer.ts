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
const MAX_SECONDS = 45;
const FRAME_RATE = 24;

export type VideoAdStyle = "premium" | "dinamico" | "educativo";

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
    throw new Error("El anuncio no puede superar 120 MB de archivos ni 45 segundos.");
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

function sceneFilter(kind: AdScene["kind"], seconds: number, index: number, style: VideoAdStyle): string {
  const fade = style === "dinamico" ? 0.15 : 0.35;
  const duration = Math.min(fade, seconds / 4);
  const source = kind === "image"
    ? `[0:v]${photoMotionFilter(index, style)},format=yuv420p[background];`
    : `[0:v]split=2[back][front];` +
      `[back]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=24:2,eq=brightness=-0.10[blur];` +
      `[front]scale=968:1460:force_original_aspect_ratio=decrease,setsar=1[subject];` +
      `[blur][subject]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FRAME_RATE},format=yuv420p[background];`;

  return source +
    `[background][1:v]overlay=0:0:shortest=1,format=yuv420p,` +
    `fade=t=in:st=0:d=${duration},fade=t=out:st=${Math.max(0, seconds - duration)}:d=${duration}[out]`;
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
  heading: string, brand: AdBrand, style: VideoAdStyle, index: number, total: number,
): Promise<Buffer> {
  const isOpening = index === 0;
  const isClosing = index === total - 1;
  const accent = safeColor(brand.primaryColor);
  const title = escapeXml(brand.clinicName.slice(0, 29));
  const category = isOpening ? "TU SONRISA, NUESTRA PRIORIDAD" :
    isClosing ? "SIGUIENTE PASO" : "ATENCIÓN ODONTOLÓGICA";
  const lines = wrapCaption(heading, isClosing ? 23 : 26);
  const fontSize = style === "dinamico" ? 77 : style === "educativo" ? 63 : 71;
  const lineHeight = fontSize + 25;
  const textTop = isOpening ? 1280 : isClosing ? 1260 : 1310;
  const textNodes = lines.map((line, number) =>
    `<text x="96" y="${textTop + number * lineHeight}" font-size="${fontSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">${escapeXml(line)}</text>`
  ).join("");
  const callToAction = isClosing
    ? `<rect x="92" y="1668" rx="21" width="608" height="106" fill="${accent}"/>
       <text x="124" y="1736" fill="#fff" font-size="43" font-family="Arial, sans-serif" font-weight="700">Solicita tu valoración</text>`
    : "";
  const infoCard = style === "educativo"
    ? `<rect x="74" y="1192" width="932" height="438" rx="25" fill="#082923" fill-opacity=".72"/>`
    : "";
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
    <rect x="70" y="90" rx="28" width="940" height="125" fill="#061916" fill-opacity=".55"/>
    <rect x="88" y="107" rx="6" width="10" height="90" fill="${accent}"/>
    <text x="120" y="163" fill="white" font-size="51" font-weight="700" font-family="Arial, sans-serif">${title}</text>
    <rect x="91" y="1160" width="128" height="9" rx="4" fill="${accent}"/>
    ${infoCard}
    <text x="95" y="1242" fill="#E2FFF6" font-size="33" font-weight="700" font-family="Arial, sans-serif" letter-spacing="2">${category}</text>
    ${textNodes}
    ${callToAction}
    <rect x="92" y="1837" width="896" height="3" fill="#fff" fill-opacity=".28"/>
    <text x="92" y="1878" fill="#fff" font-size="28" font-family="Arial, sans-serif" fill-opacity=".8">Contenido informativo · Valoración profesional</text>
  </svg>`);

  const layers: sharp.OverlayOptions[] = [{ input: svg }];
  if (brand.logoDataUrl?.startsWith("data:image/png;base64,")) {
    const logoBytes = Buffer.from(brand.logoDataUrl.slice("data:image/png;base64,".length), "base64");
    if (logoBytes.length && logoBytes.length <= 500_000) {
      const logo = await sharp(logoBytes, { limitInputPixels: 8_000_000 })
        .resize({ width: 210, height: 125, fit: "inside" }).png().toBuffer();
      layers.push({ input: logo, top: 240, left: 90 });
    }
  }
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#00000000" } })
    .composite(layers).png().toBuffer();
}

async function preparePhotoScene(bytes: Buffer): Promise<Buffer> {
  const background = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
    .rotate().resize(WIDTH, HEIGHT, { fit: "cover" })
    .blur(38).modulate({ brightness: 0.66 }).png().toBuffer();

  const foreground = await sharp(bytes, { failOn: "error", limitInputPixels: 30_000_000 })
    .rotate().resize(958, 1340, { fit: "inside", withoutEnlargement: false })
    .png().toBuffer();
  const dimensions = await sharp(foreground).metadata();
  const x = Math.round((WIDTH - (dimensions.width ?? 0)) / 2);
  const y = Math.round(720 - (dimensions.height ?? 0) / 2);

  return sharp(background)
    .composite([{ input: foreground, left: x, top: Math.max(230, y) }])
    .png().toBuffer();
}

export async function renderVideoAd(scenes: AdScene[], brand: AdBrand, style: VideoAdStyle = "premium"): Promise<Buffer> {
  validateAdScenes(scenes);
  const directory = await mkdtemp(path.join(tmpdir(), "dental-video-ad-"));

  try {
    const rendered: string[] = [];
    for (const [index, scene] of scenes.entries()) {
      const extension = mediaExtension(scene.bytes);
      if (!extension || (scene.kind === "image" && !["jpg", "png", "webp"].includes(extension)) ||
          (scene.kind === "video" && !["mp4", "mov", "webm"].includes(extension))) {
        throw new Error("El contenido del archivo no coincide con un formato multimedia admitido.");
      }

      const source = path.join(directory, `source-${index}.${scene.kind === "image" ? "png" : extension}`);
      const overlay = path.join(directory, `overlay-${index}.png`);
      const output = path.join(directory, `scene-${index}.mp4`);
      await writeFile(source, scene.kind === "image" ? await preparePhotoScene(scene.bytes) : scene.bytes);
      await writeFile(overlay, await captionOverlay(scene.heading, brand, style, index, scenes.length));

      const duration = String(scene.seconds);
      const videoFilter = sceneFilter(scene.kind, scene.seconds, index, style);

      const inputs = scene.kind === "image"
        ? ["-loop", "1", "-framerate", String(FRAME_RATE), "-i", source]
        : ["-stream_loop", "-1", "-i", source];
      await runFfmpeg([
        ...inputs, "-loop", "1", "-framerate", String(FRAME_RATE), "-i", overlay,
        "-filter_complex", videoFilter, "-map", "[out]", "-an",
        "-t", duration, "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
        "-pix_fmt", "yuv420p", "-r", String(FRAME_RATE), "-movflags", "+faststart", output,
      ]);
      rendered.push(output);
    }

    const joined = path.join(directory, "advertisement.mp4");
    await runFfmpeg([
      ...rendered.flatMap(file => ["-i", file]),
      "-filter_complex", `${rendered.map((_, index) => `[${index}:v:0]`).join("")}concat=n=${rendered.length}:v=1:a=0[out]`,
      "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", joined,
    ]);
    return await readFile(joined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
