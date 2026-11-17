import sharp from "sharp";

export const AD_CANVAS = { width: 1080, height: 1920, background: "#f5f3ee", ink: "#102e29" };
export type AdFont = "arial" | "georgia" | "verdana" | "trebuchet";
const fonts: Record<AdFont, string> = { arial: "Arial", georgia: "Georgia", verdana: "Verdana", trebuchet: "Trebuchet MS" };
const escape = (text: string) => text.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);

async function lineImage(text: string, font: AdFont, size: number) {
  return sharp({ text: { text: `<span foreground="${AD_CANVAS.ink}">${escape(text)}</span>`, font: `${fonts[font]} Bold ${size}`, dpi: 72, rgba: true } }).png().toBuffer({ resolveWithObject: true });
}

// Measure the actual font raster. Never shrink, truncate or distort patient-facing copy.
export async function layoutAdCaption(text: string, font: AdFont = "arial", size = 68) {
  const words = text.trim().split(/\s+/);
  if (!text.trim() || text.length > 180) throw new Error("El subtítulo está vacío o es demasiado largo.");
  const candidates = [ [words.join(" ")], ...words.slice(1).map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")]) ];
  const cache = new Map<string, Awaited<ReturnType<typeof lineImage>>>();
  const measure = async (line: string) => {
    if (!cache.has(line)) cache.set(line, await lineImage(line, font, size));
    return cache.get(line)!;
  };
  let best: { lines: string[]; images: Awaited<ReturnType<typeof lineImage>>[]; score: number } | undefined;
  for (const lines of candidates) {
    const images = await Promise.all(lines.map(measure));
    if (images.some(image => image.info.width > 936 || image.info.height > 100)) continue;
    const score = lines.length === 1 ? 0 : Math.abs(images[0].info.width - images[1].info.width) + 1;
    if (!best || score < best.score) best = { lines, images, score };
  }
  if (!best) throw new Error("Acorta el subtítulo: debe caber en dos líneas grandes y legibles (68 px como mínimo).");
  return { ...best, fontSize: size, lineHeight: size + 20 };
}

export function clinicalLayout(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Dimensiones clínicas inválidas.");
  const scale = Math.min(1080 / width, 1260 / height);
  const fittedWidth = Math.round(width * scale), fittedHeight = Math.round(height * scale);
  const landscape = fittedHeight <= 850;
  return { width: fittedWidth, height: fittedHeight, left: Math.round((1080 - fittedWidth) / 2),
    top: landscape ? 650 : 300, captionTop: landscape ? 370 : 1630 };
}

export function validateClosingCopy(text: string, phone?: string) {
  if ((text.match(/whatsapp/gi) ?? []).length !== 1) throw new Error("El cierre debe invitar a WhatsApp una sola vez.");
  const sentences = text.toLowerCase().split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
  if (new Set(sentences).size !== sentences.length) throw new Error("El cierre comercial contiene texto duplicado.");
  if (phone && !/^\+?[\d ()-]{7,25}$/.test(phone)) throw new Error("El contacto de WhatsApp no es válido.");
}

export async function logoLayer(data: string | null, closing = false): Promise<sharp.OverlayOptions[]> {
  if (!data) return [];
  if (!data.startsWith("data:image/png;base64,")) throw new Error("El logotipo debe ser PNG.");
  const bytes = Buffer.from(data.slice("data:image/png;base64,".length), "base64");
  if (!bytes.length || bytes.length > 500000) throw new Error("El logotipo está vacío o supera 500 KB.");
  // Flatten onto the same light canvas: dark transparent logos stay visible.
  const { data: logo, info } = await sharp(bytes, { limitInputPixels: 8000000 }).flatten({ background: AD_CANVAS.background })
    .trim({ threshold: 10 }).resize({ width: closing ? 560 : 320, height: closing ? 240 : 150, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return [{ input: logo, top: (closing ? 390 : 90) + Math.round(((closing ? 240 : 150) - info.height) / 2),
    left: closing ? Math.round((1080 - info.width) / 2) : 72 }];
}

export async function composeAdOverlay(text: string, brand: { clinicName: string; logoDataUrl: string | null }, font: AdFont, captionTop: number, closing = false, phone?: string) {
  if (closing) validateClosingCopy(text, phone);
  const caption = await layoutAdCaption(text, font, closing ? 76 : 68);
  const layers = await logoLayer(brand.logoDataUrl, closing);
  const clinic = await layoutAdCaption(brand.clinicName, "arial", closing ? 52 : 40);
  for (const [i, line] of clinic.images.entries()) {
    // Header name and logo occupy separate regions, never overlap.
    if (!closing && brand.logoDataUrl && line.info.width > 550) throw new Error("Acorta el nombre comercial para que no tape el logotipo.");
    layers.push({ input: line.data, left: closing ? Math.round((1080 - line.info.width) / 2) : brand.logoDataUrl ? 440 : 72,
      top: (closing ? 730 : 120) + i * clinic.lineHeight });
  }
  caption.images.forEach((line, i) => layers.push({ input: line.data, left: closing ? Math.round((1080 - line.info.width) / 2) : 72, top: captionTop + i * caption.lineHeight }));
  if (phone) {
    const contact = await lineImage(phone, "arial", 48);
    layers.push({ input: contact.data, left: Math.round((1080 - contact.info.width) / 2), top: 1280 });
  }
  return sharp({ create: { width: 1080, height: 1920, channels: 4, background: closing ? AD_CANVAS.background : "#00000000" } }).composite(layers).png().toBuffer();
}
