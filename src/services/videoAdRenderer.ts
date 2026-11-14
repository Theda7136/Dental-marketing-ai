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

function linesFor(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 27 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
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

function sceneFilter(kind: AdScene["kind"], seconds: number, index: number): string {
  const fade = Math.min(0.25, seconds / 4);
  const visual = kind === "image"
    ? photoMotionFilter(index)
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FRAME_RATE}`;

  return `[0:v]${visual},format=yuv420p[background];` +
    `[background][1:v]overlay=0:0:shortest=1,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}[out]`;
}

export function photoMotionFilter(index: number): string {
  // Las fotografías se acomodan con margen de seguridad para que el movimiento no recorte la imagen clínica.
  const canvasWidth = 1160;
  const canvasHeight = 2064;
  const direction = index % 2 === 0 ? 1 : -1;
  const zoom = direction === 1
    ? "min(zoom+0.0007,1.045)"
    : "max(zoom-0.0007,1.0)";
  return `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,` +
    `pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `zoompan=z='${zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':` +
    `d=1:s=${WIDTH}x${HEIGHT}:fps=${FRAME_RATE},setsar=1`;
}

async function captionOverlay(heading: string, brand: AdBrand): Promise<Buffer> {
  const label = escapeXml(brand.clinicName.slice(0, 60));
  const lines = linesFor(heading);
  const centerY = 1460 - ((lines.length - 1) * 57);
  const caption = lines.map((line, index) => `<text x="84" y="${centerY + index * 114}" fill="white" font-family="Arial, sans-serif" font-size="72" font-weight="bold">${escapeXml(line)}</text>`).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity=".12"/><stop offset="50%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".82"/></linearGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
    <rect x="74" y="117" width="12" height="77" rx="6" fill="${safeColor(brand.primaryColor)}"/>
    <text x="112" y="172" fill="white" font-size="47" font-family="Arial, sans-serif" font-weight="bold">${label}</text>
    ${caption}
    <rect x="84" y="1760" width="176" height="8" rx="4" fill="${safeColor(brand.primaryColor)}"/>
  </svg>`);

  const layers: sharp.OverlayOptions[] = [{ input: svg }];
  if (brand.logoDataUrl?.startsWith("data:image/png;base64,")) {
    const logoBytes = Buffer.from(brand.logoDataUrl.slice("data:image/png;base64,".length), "base64");
    if (logoBytes.length > 0 && logoBytes.length <= 500_000) {
      const logo = await sharp(logoBytes, { limitInputPixels: 8_000_000 })
        .resize({ width: 240, height: 140, fit: "inside" }).png().toBuffer();
      layers.push({ input: logo, top: 220, left: 86 });
    }
  }
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#00000000" } })
    .composite(layers).png().toBuffer();
}

export async function renderVideoAd(scenes: AdScene[], brand: AdBrand): Promise<Buffer> {
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

      const source = path.join(directory, `source-${index}.${extension}`);
      const overlay = path.join(directory, `overlay-${index}.png`);
      const output = path.join(directory, `scene-${index}.mp4`);
      await writeFile(source, scene.bytes);
      await writeFile(overlay, await captionOverlay(scene.heading, brand));

      const duration = String(scene.seconds);
      const videoFilter = sceneFilter(scene.kind, scene.seconds, index);

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
