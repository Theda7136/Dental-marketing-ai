import sharp from "sharp";
import { clinicalGuardrails } from "../config/clinicalGuardrails";

const WIDTH = 1080;
const HEIGHT = 1350;
const MAX_BYTES = 20 * 1024 * 1024;

export type PhotoLayout = "AUTO" | "CONTAIN" | "COVER";
export type PhotoBackground = "LIGHT" | "BLUR";
export type PhotoPreset = "CLINICAL" | "EDUCATIONAL" | "COMMERCIAL";

export interface PhotoOptions {
  layout: PhotoLayout;
  background: PhotoBackground;
  preset: PhotoPreset;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_PHOTO_OPTIONS: PhotoOptions = {
  layout: "AUTO",
  background: "LIGHT",
  preset: "CLINICAL",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

export class ImageServiceError extends Error {
  readonly code: "INVALID_IMAGE" | "INVALID_PROCEDURE" | "BACKGROUND_REMOVAL_FAILED" | "TEMPLATE_FAILED";

  constructor(message: string, code: ImageServiceError["code"]) {
    super(message);
    this.name = "ImageServiceError";
    this.code = code;
  }
}

export function parsePhotoOptions(input: Record<string, unknown>): PhotoOptions {
  const layout = input.layout ?? "AUTO";
  const background = input.background ?? "LIGHT";
  const preset = input.preset ?? "CLINICAL";
  const zoom = Number(input.zoom ?? 1);
  const offsetX = Number(input.offsetX ?? 0);
  const offsetY = Number(input.offsetY ?? 0);

  if (!["AUTO", "CONTAIN", "COVER"].includes(String(layout)) ||
      !["LIGHT", "BLUR"].includes(String(background)) ||
      !["CLINICAL", "EDUCATIONAL", "COMMERCIAL"].includes(String(preset)) ||
      !Number.isFinite(zoom) || zoom < 1 || zoom > 1.6 ||
      !Number.isFinite(offsetX) || offsetX < -100 || offsetX > 100 ||
      !Number.isFinite(offsetY) || offsetY < -100 || offsetY > 100) {
    throw new ImageServiceError("Opciones de encuadre no válidas.", "INVALID_IMAGE");
  }

  return {
    layout: layout as PhotoLayout,
    background: background as PhotoBackground,
    preset: preset as PhotoPreset,
    zoom, offsetX, offsetY,
  };
}

function assertProcedure(procedure: string): void {
  if (!clinicalGuardrails.allowedDentalTerms.some((term) => term === procedure)) {
    throw new ImageServiceError("Selecciona un procedimiento permitido.", "INVALID_PROCEDURE");
  }
}

async function getSource(source: Uint8Array): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!(source instanceof Uint8Array) || source.length === 0 || source.length > MAX_BYTES) {
    throw new ImageServiceError("La foto debe pesar como máximo 20 MB.", "INVALID_IMAGE");
  }

  try {
    const buffer = Buffer.from(source);
    const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000 }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") ||
        !metadata.width || !metadata.height || metadata.width < 8 || metadata.height < 8 ||
        metadata.width > 12000 || metadata.height > 12000) {
      throw new Error("Formato o dimensiones no compatibles");
    }
    const oriented = await sharp(buffer).rotate().png().toBuffer();
    const orientedMetadata = await sharp(oriented).metadata();
    return {
      buffer: oriented,
      width: orientedMetadata.width!,
      height: orientedMetadata.height!,
    };
  } catch {
    throw new ImageServiceError("La fotografía es inválida o no es JPEG, PNG o WebP.", "INVALID_IMAGE");
  }
}

function backgroundColor(preset: PhotoPreset): string {
  if (preset === "COMMERCIAL") return "#F6F2EB";
  if (preset === "EDUCATIONAL") return "#EDF5F2";
  return "#F8FAF9";
}

/**
 * Automatic framing must preserve the entire clinical image; cropping is opt-in.
 */
export async function renderSocialPhoto(
  source: Uint8Array,
  options: PhotoOptions = DEFAULT_PHOTO_OPTIONS,
  canvasHeight = HEIGHT,
): Promise<Uint8Array> {
  const { buffer, width, height } = await getSource(source);
  const layout = options.layout === "AUTO" ? "CONTAIN" : options.layout;
  const baseZoom = Math.max(WIDTH / width, canvasHeight / height);
  const containZoom = Math.min(WIDTH / width, canvasHeight / height);
  const scale = (layout === "COVER" ? baseZoom : containZoom) * options.zoom;
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const resized = await sharp(buffer).resize(scaledWidth, scaledHeight, { fit: "fill" })
    .ensureAlpha().png().toBuffer();

  const wantedLeft = Math.round((WIDTH - scaledWidth) / 2 + options.offsetX * Math.max(0, scaledWidth - WIDTH) / 200);
  const wantedTop = Math.round((canvasHeight - scaledHeight) / 2 + options.offsetY * Math.max(0, scaledHeight - canvasHeight) / 200);
  const left = scaledWidth >= WIDTH ? Math.max(WIDTH - scaledWidth, Math.min(0, wantedLeft)) : wantedLeft;
  const top = scaledHeight >= canvasHeight ? Math.max(canvasHeight - scaledHeight, Math.min(0, wantedTop)) : wantedTop;
  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clipX = Math.max(0, -left);
  const clipY = Math.max(0, -top);
  const clippedWidth = Math.min(WIDTH - clippedLeft, scaledWidth - clipX);
  const clippedHeight = Math.min(canvasHeight - clippedTop, scaledHeight - clipY);
  if (clippedWidth < 1 || clippedHeight < 1) {
    throw new ImageServiceError("El encuadre deja la fotografía fuera del lienzo.", "TEMPLATE_FAILED");
  }

  const foreground = await sharp(resized)
    .extract({ left: clipX, top: clipY, width: clippedWidth, height: clippedHeight })
    .png().toBuffer();

  let background: Buffer;
  if (options.background === "BLUR") {
    background = await sharp(buffer)
      .resize(WIDTH, canvasHeight, { fit: "cover", position: "attention" })
      .blur(28).modulate({ brightness: 1.08, saturation: 0.55 })
      .png().toBuffer();
  } else {
    background = await sharp({
      create: { width: WIDTH, height: canvasHeight, channels: 4, background: backgroundColor(options.preset) },
    }).png().toBuffer();
  }

  return new Uint8Array(await sharp(background)
    .composite([{ input: foreground, left: clippedLeft, top: clippedTop }])
    .png().toBuffer());
}

export async function renderStoryPhoto(input: {
  cleanImage: Uint8Array;
  procedureName: string;
  options?: PhotoOptions;
  brand?: PhotoBrand | null;
}): Promise<Uint8Array> {
  return overlayOnClinicTemplate({ ...input, canvasHeight: 1920 });
}

export async function removeClinicalBackground(image: Uint8Array): Promise<Uint8Array> {
  const source = await getSource(image);
  return new Uint8Array(await sharp(source.buffer).png().toBuffer());
}

export interface PhotoBrand {
  clinicName: string;
  primaryColor: string;
  fontFamily: string;
  logoDataUrl: string | null;
}

export async function overlayOnClinicTemplate(input: {
  cleanImage: Uint8Array;
  procedureName: string;
  options?: PhotoOptions;
  brand?: PhotoBrand | null;
  canvasHeight?: number;
}): Promise<Uint8Array> {
  if (input.procedureName) assertProcedure(input.procedureName);

  const canvasHeight = input.canvasHeight ?? HEIGHT;
  const photoOptions = canvasHeight === 1920
    ? { ...DEFAULT_PHOTO_OPTIONS, ...input.options, background: "LIGHT" as const, layout: "CONTAIN" as const, zoom: 1, offsetX: 0, offsetY: 0 }
    : input.options;
  const photo = Buffer.from(await renderSocialPhoto(input.cleanImage, photoOptions, canvasHeight));
  const logoDataUrl = input.brand?.logoDataUrl;
  if (!logoDataUrl?.startsWith("data:image/png;base64,")) return new Uint8Array(photo);

  const logoSource = Buffer.from(logoDataUrl.slice("data:image/png;base64,".length), "base64");
  const logo = await sharp(logoSource, { failOn: "error", limitInputPixels: 8_000_000 })
    .resize({ width: 150, height: 110, fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
  const { width = 0, height = 0 } = await sharp(logo).metadata();
  if (!width || !height) throw new ImageServiceError("El logotipo configurado no es válido.", "TEMPLATE_FAILED");

  // Keep the logo clear of bottom navigation overlays on vertical stories.
  const margin = 42;
  const bottomInset = canvasHeight === 1920 ? 225 : 52;
  return new Uint8Array(await sharp(photo).composite([{
    input: logo,
    left: WIDTH - width - margin,
    top: canvasHeight - height - bottomInset,
  }]).png().toBuffer());
}
