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
  if (!clinicalGuardrails.allowedDentalTerms.includes(procedure)) {
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
    return { buffer, width: metadata.width, height: metadata.height };
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
 * Keep all pixels of the clinical photo unless the operator explicitly chooses COVER.
 * For extreme aspect ratios, a mild blurred copy avoids letterboxing without cropping evidence.
 */
export async function renderSocialPhoto(
  source: Uint8Array,
  options: PhotoOptions = DEFAULT_PHOTO_OPTIONS,
): Promise<Uint8Array> {
  const { buffer, width, height } = await getSource(source);
  const layout = options.layout === "AUTO"
    ? (width / height > 0.58 && width / height < 0.94 ? "COVER" : "CONTAIN")
    : options.layout;
  const baseZoom = Math.max(WIDTH / width, HEIGHT / height);
  const containZoom = Math.min(WIDTH / width, HEIGHT / height);
  const scale = (layout === "COVER" ? baseZoom : containZoom) * options.zoom;
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const resized = await sharp(buffer).rotate().resize(scaledWidth, scaledHeight, { fit: "fill" })
    .ensureAlpha().png().toBuffer();

  const left = Math.round((WIDTH - scaledWidth) / 2 + options.offsetX * Math.max(0, scaledWidth - WIDTH) / 100);
  const top = Math.round((HEIGHT - scaledHeight) / 2 + options.offsetY * Math.max(0, scaledHeight - HEIGHT) / 100);
  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clipX = Math.max(0, -left);
  const clipY = Math.max(0, -top);
  const clippedWidth = Math.min(WIDTH - clippedLeft, scaledWidth - clipX);
  const clippedHeight = Math.min(HEIGHT - clippedTop, scaledHeight - clipY);
  if (clippedWidth < 1 || clippedHeight < 1) {
    throw new ImageServiceError("El encuadre deja la fotografía fuera del lienzo.", "TEMPLATE_FAILED");
  }

  const foreground = await sharp(resized)
    .extract({ left: clipX, top: clipY, width: clippedWidth, height: clippedHeight })
    .png().toBuffer();

  let background: Buffer;
  if (options.background === "BLUR") {
    background = await sharp(buffer).rotate()
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
      .blur(28).modulate({ brightness: 1.08, saturation: 0.55 })
      .png().toBuffer();
  } else {
    background = await sharp({
      create: { width: WIDTH, height: HEIGHT, channels: 4, background: backgroundColor(options.preset) },
    }).png().toBuffer();
  }

  return new Uint8Array(await sharp(background)
    .composite([{ input: foreground, left: clippedLeft, top: clippedTop }])
    .png().toBuffer());
}

export async function removeClinicalBackground(image: Uint8Array): Promise<Uint8Array> {
  const source = await getSource(image);
  return new Uint8Array(await sharp(source.buffer).rotate().png().toBuffer());
}

export async function overlayOnClinicTemplate(input: {
  cleanImage: Uint8Array;
  procedureName: string;
  logo?: Uint8Array;
  options?: PhotoOptions;
}): Promise<Uint8Array> {
  assertProcedure(input.procedureName);
  return renderSocialPhoto(input.cleanImage, input.options);
}
