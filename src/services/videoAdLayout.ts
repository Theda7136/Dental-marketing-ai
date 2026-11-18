import sharp from "sharp";

export const AD_CANVAS = { width: 1080, height: 1920, background: "#F7F6F2", ink: "#10243A" };
export const CAPTION_SIZE = 76;
export const CLOSING_SIZE = 88;
export type AdFont = "arial" | "georgia" | "verdana" | "trebuchet";
const fonts: Record<AdFont, string> = { arial: "Arial", georgia: "Georgia", verdana: "Verdana", trebuchet: "Trebuchet MS" };
const escape = (text: string) => text.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);

async function lineImage(text: string, font: AdFont, size: number, color = AD_CANVAS.ink) {
  return sharp({ text: { text: `<span foreground="${color}">${escape(text)}</span>`, font: `${fonts[font]} ${size}`, dpi: 72, rgba: true } }).png().toBuffer({ resolveWithObject: true });
}

// Measure the actual font raster. Never shrink, truncate or distort patient-facing copy.
export async function layoutAdCaption(text: string, font: AdFont = "arial", size = CAPTION_SIZE) {
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
    if (images.some(image => image.info.width > 900 || image.info.height > size + 24)) continue;
    const score = lines.length === 1 ? 0 : Math.abs(images[0].info.width - images[1].info.width) + 1;
    if (!best || score < best.score) best = { lines, images, score };
  }
  if (!best && size > 64) return layoutAdCaption(text, font, size - 8);
  if (!best) throw new Error("El subtítulo no cabe en dos líneas legibles. Reduce el texto.");
  return { ...best, fontSize: size, lineHeight: size + 20 };
}

export const AD_ZONES = {
  brand: { top: 90, bottom: 270 },
  media: { top: 310, bottom: 1430 },
  caption: { top: 1530, bottom: 1770 },
} as const;

export function clinicalLayout(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Dimensiones clínicas inválidas.");
  }

  const mediaWidth = 1080;
  const mediaHeight = AD_ZONES.media.bottom - AD_ZONES.media.top;
  const scale = Math.min(mediaWidth / width, mediaHeight / height);
  const fittedWidth = Math.max(2, Math.round(width * scale / 2) * 2);
  const fittedHeight = Math.max(2, Math.round(height * scale / 2) * 2);
  const top = AD_ZONES.media.top + Math.round((mediaHeight - fittedHeight) / 2);

  return {
    width: fittedWidth,
    height: fittedHeight,
    left: Math.round((1080 - fittedWidth) / 2),
    top,
    captionTop: AD_ZONES.caption.top,
  };
}

export function validateClosingCopy(text: string, phone?: string) {
  if ((text.match(/whatsapp/gi) ?? []).length !== 1) throw new Error("El cierre debe invitar a WhatsApp una sola vez.");
  const actions = text.match(/\b(?:message(?=\s+(?:us|me|our|the)\b)|write|contact|book|schedule|call|visit|send|chat|escr[ií]benos|escribe|cont[aá]ctanos|agenda|reserva|llama|visita|env[ií]a|hablemos|conversemos)\b/gi) ?? [];
  if (actions.length !== 1 || text.trim().split(/\s+/).length > 8) throw new Error("El cierre debe tener una sola llamada a la acción breve.");
  const sentences = text.toLowerCase().split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
  if (new Set(sentences).size !== sentences.length) throw new Error("El cierre comercial contiene texto duplicado.");
  if (phone && !/^\+?[\d ()-]{7,25}$/.test(phone)) throw new Error("El contacto de WhatsApp no es válido.");
}

export async function logoLayer(data: string | null, closing = false): Promise<sharp.OverlayOptions[]> {
  if (!data) return [];
  if (!data.startsWith("data:image/png;base64,")) throw new Error("El logotipo debe ser PNG.");
  const bytes = Buffer.from(data.slice("data:image/png;base64,".length), "base64");
  if (!bytes.length || bytes.length > 500000) throw new Error("El logotipo está vacío o supera 500 KB.");
  // Give the original logo a light matte so dark transparent lettering remains visible.
  const { data: logo, info } = await sharp(bytes, { limitInputPixels: 8000000 }).flatten({ background: AD_CANVAS.background })
    .trim({ threshold: 10 }).resize({ width: closing ? 760 : 420, height: closing ? 300 : 150, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return [{ input: logo, top: (closing ? 570 : 60) + Math.round(((closing ? 300 : 150) - info.height) / 2),
    left: closing ? Math.round((1080 - info.width) / 2) : 72 }];
}

export async function composeAdOverlay(text: string, brand: { clinicName: string; logoDataUrl: string | null }, font: AdFont, captionTop: number, closing = false, phone?: string, mediaBox?: ReturnType<typeof clinicalLayout>) {
  if (closing) validateClosingCopy(text, phone);
  const caption = await layoutAdCaption(text, font, closing ? CLOSING_SIZE : CAPTION_SIZE);
  const layers = await logoLayer(brand.logoDataUrl, closing);
  if (!closing && mediaBox) {
    const stage = Buffer.from('<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="264" fill="#F7F6F2"/><rect y="1450" width="1080" height="470" fill="#F7F6F2"/><rect x="72" y="1490" width="90" height="7" rx="3" fill="#10243A"/><path d="M72 1800 H1008" stroke="#10243A" stroke-width="2" opacity=".22"/><path d="M72 285 H1008 M72 1425 H1008" stroke="#F7F6F2" stroke-width="2" opacity=".45"/></svg>');
    layers.push({ input: stage, left: 0, top: 0 });
  }
  if (closing) {
    const panel = Buffer.from('<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="420" width="1080" height="1100" fill="#10243A"/><path d="M100 480 H980 M100 1460 H980" stroke="#F7F6F2" opacity=".4" stroke-width="2"/></svg>');
    layers.unshift({ input: panel, left: 0, top: 0 });
  }
  // A supplied logo is the primary brand identity, not a secondary decoration
  // next to a competing account name such as "Dental Studio".
  if (!brand.logoDataUrl) {
    const clinic = await layoutAdCaption(brand.clinicName, "arial", closing ? 88 : 40);
    for (const [i, line] of clinic.images.entries()) {
      layers.push({ input: line.data, left: closing ? Math.round((1080 - line.info.width) / 2) : 72,
        top: (closing ? 730 : 100) + i * clinic.lineHeight });
    }
  }
  if (closing) {
    const rule = Buffer.from('<svg width="96" height="4"><rect width="96" height="4" rx="2" fill="#F7F6F2" opacity=".7"/></svg>');
    layers.push({ input: rule, left: 492, top: 940 });
  }
  const captionHeight = caption.images.reduce((height, line, i) => height + (i ? 20 : 0) + line.info.height, 0);
  const captionStart = closing ? 1030 : Math.max(AD_ZONES.caption.top, Math.round((AD_ZONES.caption.top + AD_ZONES.caption.bottom - captionHeight) / 2));
  let lineTop = captionStart;
  const visibleCaption = closing ? await Promise.all(caption.lines.map(line => lineImage(line, font, caption.fontSize, "#F7F6F2"))) : caption.images;
  visibleCaption.forEach(line => {
    layers.push({ input: line.data, left: Math.round((1080 - line.info.width) / 2), top: lineTop });
    lineTop += line.info.height + 20;
  });
  if (phone) {
    const contact = await lineImage(phone, "arial", 48, closing ? "#F7F6F2" : AD_CANVAS.ink);
    layers.push({ input: contact.data, left: Math.round((1080 - contact.info.width) / 2), top: 1320 });
  }
  return sharp({ create: { width: 1080, height: 1920, channels: 4, background: closing ? AD_CANVAS.background : "#00000000" } }).composite(layers).png().toBuffer();
}
