/**
 * Servicio de procesamiento publicitario y clínico de imágenes.
 * Aplica mejoras profesionales de iluminación, contraste y nitidez (efecto estudio)
 * manteniendo la fidelidad clínica sin marcos extraños ni textos invasivos.
 */

import sharp from "sharp";
import { clinicalGuardrails } from "../config/clinicalGuardrails";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_EDGE = 12_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

export type ImageServiceErrorCode =
  | "INVALID_IMAGE"
  | "INVALID_PROCEDURE"
  | "BACKGROUND_REMOVAL_FAILED"
  | "TEMPLATE_FAILED";

export class ImageServiceError extends Error {
  readonly code: ImageServiceErrorCode;

  constructor(message: string, code: ImageServiceErrorCode) {
    super(message);
    this.name = "ImageServiceError";
    this.code = code;
  }
}

export interface ClinicTemplateInput {
  cleanImage: Uint8Array;
  procedureName: string;
  logo?: Uint8Array;
  backgroundColor?: string;
  primaryColor?: string;
  clinicName?: string;
  fontFamily?: string;
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ImageServiceError(
      `${label} debe ser el contenido binario de una imagen.`,
      "INVALID_IMAGE",
    );
  }

  if (value.byteLength === 0) {
    throw new ImageServiceError(`${label} está vacía.`, "INVALID_IMAGE");
  }

  if (value.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageServiceError(
      `${label} supera el máximo de 20 MB.`,
      "INVALID_IMAGE",
    );
  }

  return value;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveProcedureName(procedureName: unknown): string {
  if (typeof procedureName !== "string" || procedureName.trim().length === 0) {
    throw new ImageServiceError(
      "El procedimiento es obligatorio.",
      "INVALID_PROCEDURE",
    );
  }

  const canonical = clinicalGuardrails.allowedDentalTerms.find(
    (term) => normalize(term) === normalize(procedureName),
  );

  if (!canonical) {
    throw new ImageServiceError(
      `El procedimiento "${procedureName.trim()}" no está permitido.`,
      "INVALID_PROCEDURE",
    );
  }

  clinicalGuardrails.validate(canonical);
  return canonical;
}

async function assertDecodableImage(
  bytes: Uint8Array,
  label: string,
): Promise<void> {
  const buffer = asBuffer(assertBytes(bytes, label));

  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new ImageServiceError(
        `${label} debe ser JPEG, PNG o WebP.`,
        "INVALID_IMAGE",
      );
    }

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 8 ||
      metadata.height < 8
    ) {
      throw new ImageServiceError(
        `${label} no tiene un tamaño utilizable.`,
        "INVALID_IMAGE",
      );
    }

    if (metadata.width > MAX_SOURCE_EDGE || metadata.height > MAX_SOURCE_EDGE) {
      throw new ImageServiceError(
        `${label} supera el tamaño máximo permitido.`,
        "INVALID_IMAGE",
      );
    }

    await sharp(buffer, { failOn: "error" }).stats();
  } catch (error) {
    if (error instanceof ImageServiceError) {
      throw error;
    }

    throw new ImageServiceError(
      `${label} está corrupta o no es una imagen válida.`,
      "INVALID_IMAGE",
    );
  }
}

export async function removeClinicalBackground(
  image: Uint8Array,
): Promise<Uint8Array> {
  await assertDecodableImage(image, "La foto clínica");

  try {
    // Aplicamos edición publicitaria inicial a la foto antes de componerla
    return await sharp(asBuffer(image), { failOn: "error" })
      .rotate()
      .modulate({
        brightness: 1.02, // Sutil realce de luminosidad general
        saturation: 1.05, // Colores más vivos y saludables en los tejidos
      })
      .sharpen({ sigma: 1.0 }) // Mayor definición en los bordes dentales
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof ImageServiceError) {
      throw error;
    }

    throw new ImageServiceError(
      "No se pudo procesar la foto clínica.",
      "BACKGROUND_REMOVAL_FAILED",
    );
  }
}

/**
 * Transforma la foto clínica en una pieza publicitaria profesional de alta gama.
 * Centra la imagen con realce comercial sobre un fondo oscuro corporativo elegante (1080x1350).
 */
export async function overlayOnClinicTemplate(
  input: ClinicTemplateInput,
): Promise<Uint8Array> {
  if (typeof input !== "object" || input === null) {
    throw new ImageServiceError(
      "Los datos de la plantilla son obligatorios.",
      "TEMPLATE_FAILED",
    );
  }

  resolveProcedureName(input.procedureName);

  try {
    const rawImage = asBuffer(input.cleanImage);
    await assertDecodableImage(rawImage, "La imagen limpia");

    // 1. Optimizamos y estilizamos la foto con calidad de estudio publicitario
    const enhancedPhoto = await sharp(rawImage)
      .rotate()
      .resize(960, 1100, {
        fit: "inside",
        withoutEnlargement: false,
      })
      .modulate({
        brightness: 1.03, // Brillo ideal para destacar el esmalte
        saturation: 1.06, // Realza ligeramente el contraste de los tejidos
      })
      .sharpen({ sigma: 1.2 }) // Definición profesional publicitaria
      .png()
      .toBuffer();

    const bg = input.backgroundColor && /^#[0-9a-f]{6}$/i.test(input.backgroundColor)
      ? input.backgroundColor : "#0a1817";
    const accent = input.primaryColor && /^#[0-9a-f]{6}$/i.test(input.primaryColor)
      ? input.primaryColor : "#147c72";
    const clinicName = (input.clinicName || "Dental Studio").slice(0, 80);
    const escapedName = clinicName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const font = input.fontFamily === "serif" ? "Georgia, serif" : input.fontFamily === "modern" ? "Arial, sans-serif" : "sans-serif";
    const nameOverlay = Buffer.from(`<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="1210" width="1080" height="140" fill="${bg}"/>
      <rect x="60" y="1215" width="100" height="5" rx="2" fill="${accent}"/>
      <text x="60" y="1285" font-family="${font}" font-size="37" fill="#ffffff" font-weight="600">${escapedName}</text>
    </svg>`);
    const composites: sharp.OverlayOptions[] = [
      { input: enhancedPhoto, gravity: "center" },
      { input: nameOverlay, top: 0, left: 0 },
    ];
    if (input.logo) {
      const logo = await sharp(asBuffer(input.logo)).resize(115, 115, { fit: "inside" }).png().toBuffer();
      composites.push({ input: logo, top: 1218, left: 900 });
    }

    const advertisingCanvas = await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 4,
        background: bg,
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return advertisingCanvas;
  } catch (error) {
    if (error instanceof ImageServiceError) {
      throw error;
    }

    throw new ImageServiceError(
      "No se pudo generar la pieza publicitaria de la imagen.",
      "TEMPLATE_FAILED",
    );
  }
}