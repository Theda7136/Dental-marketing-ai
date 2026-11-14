
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getStudioAccess } from "@/lib/studioAccess";
import {
  ClinicalGuardrailWarning,
  clinicalGuardrails,
} from "../../../config/clinicalGuardrails";
import { prisma } from "../../../lib/prisma";
import { deletePostMedia, storePostMedia } from "../../../services/mediaStorage";
import {
  AIProviderError,
  generateDentalVariants,
  describeDentalImage,
} from "../../../services/aiProvider";
import {
  ImageServiceError,
  overlayOnClinicTemplate,
  renderStoryPhoto,
  removeClinicalBackground,
  parsePhotoOptions,
  type PhotoOptions,
} from "../../../services/imageService";
import {
  VideoServiceError,
  overlayKaraokeSubtitles,
  muteClinicalVideo,
  renderVerticalClinicalVideo,
  renderPhotoReel,
  overlayVideoLogo,
  type TranscriptWord,
} from "../../../services/videoService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

type MediaKind = "image" | "video";

class RequestInputError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RequestInputError";
    this.status = status;
    this.code = code;
  }
}

interface CreatePostInput {
  procedureName: string;
  media: Uint8Array;
  transcript?: TranscriptWord[];
  notes?: string;
  enableVision?: boolean;
  selectedStyle: "EDUCATIONAL" | "COMMERCIAL";
  visionConsent: boolean;
  muteAudio: boolean;
  photoOptions: PhotoOptions;
  deliveryFormat: "FEED" | "REEL" | "STORY";
}

function readDeliveryFormat(value: unknown): "FEED" | "REEL" | "STORY" {
  if (value === undefined || value === null || value === "FEED") return "FEED";
  if (value === "REEL" || value === "STORY") return value;
  throw new RequestInputError(400, "INVALID_DELIVERY_FORMAT", "Selecciona feed, Reel o Historia.");
}

function readCopyStyle(value: unknown): "EDUCATIONAL" | "COMMERCIAL" {
  if (value === "EDUCATIONAL" || value === "COMMERCIAL") return value;
  throw new RequestInputError(400, "INVALID_STYLE", "Elige un enfoque educativo o comercial.");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveProcedureName(procedureName: string): string {
  const canonical = clinicalGuardrails.allowedDentalTerms.find(
    (term) => normalize(term) === normalize(procedureName),
  );

  if (!canonical) {
    throw new RequestInputError(
      400,
      "INVALID_PROCEDURE",
      `El procedimiento "${procedureName.trim()}" no está en los términos odontológicos permitidos.`,
    );
  }

  clinicalGuardrails.validate(canonical);
  return canonical;
}

function detectMediaKind(bytes: Uint8Array): MediaKind {
  if (bytes.byteLength < 12) {
    throw new RequestInputError(
      400,
      "UNSUPPORTED_FORMAT",
      "El archivo está incompleto. Envía una imagen JPEG, PNG o WebP, o un video MP4, MOV o WebM.",
    );
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";

  if (isJpeg || isPng || isWebp) {
    return "image";
  }

  const isWebm =
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3;
  const isIsoBmff = Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp";

  if (isWebm || isIsoBmff) {
    return "video";
  }

  throw new RequestInputError(
    400,
    "UNSUPPORTED_FORMAT",
    "El formato no es compatible. Usa una imagen JPEG, PNG o WebP, o un video MP4, MOV o WebM.",
  );
}

function decodeBase64Media(value: string): Uint8Array {
  const trimmed = value.trim();
  const payload = trimmed.startsWith("data:")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const compact = payload.replace(/\s/g, "");

  if (compact.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    throw new RequestInputError(
      400,
      "INVALID_MEDIA",
      "El archivo en base64 no es válido.",
    );
  }

  const bytes = Buffer.from(compact, "base64");
  if (bytes.byteLength === 0) {
    throw new RequestInputError(400, "INVALID_MEDIA", "El archivo está vacío.");
  }

  return new Uint8Array(bytes);
}

function readNotes(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > 800) {
    throw new RequestInputError(
      400,
      "INVALID_NOTES",
      "Las notas de la consulta superan los 800 caracteres.",
    );
  }

  clinicalGuardrails.validate(trimmed);
  return trimmed;
}

function parseTranscript(value: unknown): TranscriptWord[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new RequestInputError(
        400,
        "INVALID_TRANSCRIPT",
        "La transcripción del video no es un JSON válido.",
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new RequestInputError(
      400,
      "INVALID_TRANSCRIPT",
      "La transcripción debe ser una lista de palabras con tiempos.",
    );
  }

  return parsed as TranscriptWord[];
}

async function readUpload(file: FormDataEntryValue | null): Promise<Uint8Array> {
  if (!(file instanceof File) || file.size === 0) {
    throw new RequestInputError(
      400,
      "INVALID_MEDIA",
      "Adjunta la imagen o el video en el campo media.",
    );
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new RequestInputError(
      400,
      "FILE_TOO_LARGE",
      "El archivo supera el máximo de 80 MB.",
    );
  }

  return new Uint8Array(await file.arrayBuffer());
}

async function readRequestInput(request: Request): Promise<CreatePostInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new RequestInputError(
        400,
        "INVALID_BODY",
        "No se pudo leer el formulario con el archivo y el procedimiento.",
      );
    }

    const procedureName = form.get("procedureName");
    if (typeof procedureName !== "string" || procedureName.trim().length === 0) {
      throw new RequestInputError(
        400,
        "INVALID_PROCEDURE",
        "El campo procedureName es obligatorio.",
      );
    }

    const media = await readUpload(
      form.get("media") ?? form.get("image") ?? form.get("photo") ?? form.get("video"),
    );

    return {
      procedureName: procedureName.trim(),
      media,
      transcript: parseTranscript(form.get("transcript")),
      notes: readNotes(form.get("notes")),
      enableVision: form.get("visionConsent") === "true",
      selectedStyle: readCopyStyle(form.get("selectedStyle")),
      visionConsent: form.get("visionConsent") === "true",
      muteAudio: form.get("muteAudio") === "true",
      deliveryFormat: readDeliveryFormat(form.get("deliveryFormat")),
      photoOptions: parsePhotoOptions({
        layout: form.get("photoLayout") ?? "AUTO",
        background: form.get("photoBackground") ?? "LIGHT",
        preset: form.get("photoPreset") ?? "CLINICAL",
        zoom: form.get("photoZoom") ?? 1,
        offsetX: form.get("photoOffsetX") ?? 0,
        offsetY: form.get("photoOffsetY") ?? 0,
      }),
    };
  }

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RequestInputError(
        400,
        "INVALID_BODY",
        "El cuerpo JSON de la petición no es válido.",
      );
    }

    if (typeof body !== "object" || body === null) {
      throw new RequestInputError(
        400,
        "INVALID_BODY",
        "El cuerpo debe incluir procedureName y el archivo multimedia.",
      );
    }

    const record = body as Record<string, unknown>;
    if (typeof record.procedureName !== "string" || record.procedureName.trim().length === 0) {
      throw new RequestInputError(
        400,
        "INVALID_PROCEDURE",
        "El campo procedureName es obligatorio.",
      );
    }

    const encoded = record.mediaBase64 ?? record.imageBase64 ?? record.videoBase64;
    if (typeof encoded !== "string") {
      throw new RequestInputError(
        400,
        "INVALID_MEDIA",
        "Envía el archivo en mediaBase64, imageBase64 o videoBase64.",
      );
    }

    const media = decodeBase64Media(encoded);
    if (media.byteLength > MAX_VIDEO_BYTES) {
      throw new RequestInputError(
        400,
        "FILE_TOO_LARGE",
        "El archivo supera el máximo de 80 MB.",
      );
    }

    return {
      procedureName: record.procedureName.trim(),
      media,
      transcript: parseTranscript(record.transcript),
      notes: readNotes(record.notes),
      enableVision: record.visionConsent === true,
      selectedStyle: readCopyStyle(record.selectedStyle),
      visionConsent: record.visionConsent === true,
      muteAudio: record.muteAudio === true,
      deliveryFormat: readDeliveryFormat(record.deliveryFormat),
      photoOptions: parsePhotoOptions({
        layout: record.photoLayout,
        background: record.photoBackground,
        preset: record.photoPreset,
        zoom: record.photoZoom,
        offsetX: record.photoOffsetX,
        offsetY: record.photoOffsetY,
      }),
    };
  }

  throw new RequestInputError(
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Envía multipart/form-data o JSON con el procedimiento y el archivo multimedia.",
  );
}

function consultationNotes(notes: string | undefined): string | undefined {
  if (!notes) {
    return undefined;
  }

  return `HECHOS CONFIRMADOS POR LA CLÍNICA (prioridad máxima en ambos copys): ${notes}. Describe este caso específico respetando estas palabras clave. No inventes características, procedimientos ni resultados adicionales.`;
}

function imageContextFor(procedureName: string, notes?: string): string {
  return [
    "Foto clínica preparada para Instagram y TikTok.",
    `El odontólogo indicó el procedimiento ${procedureName}.`,
    "La fotografía es material visual de apoyo y no demuestra por sí sola un tratamiento.",
    "Si existen notas confirmadas, el tema central del copy debe ser ese caso concreto. No sustituyas esas notas por publicidad genérica.",
    consultationNotes(notes),
    "No inventes hallazgos, medidas ni resultados que no hayan sido confirmados en consulta.",
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function videoContextFor(
  procedureName: string,
  hasTranscript: boolean,
  notes?: string,
): string {
  return [
    "Guion y copy para un Reel o TikTok vertical de un caso clínico.",
    `El odontólogo indicó el procedimiento ${procedureName}.`,
    hasTranscript
      ? "El video incluye una conversación entre el doctor y el paciente. No cites diálogos que no estén confirmados."
      : "El video es un clip corto del caso, sin una transcripción adjunta.",
    "Escribe el texto que acompaña al video, no la descripción de una foto fija.",
    consultationNotes(notes),
    "No inventes hallazgos, medidas ni resultados que no hayan sido confirmados en consulta.",
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function buildCaption(draft: {
  caption: string;
  hashtags: readonly string[];
  suggestedCallToAction: string;
}): string {
  return [draft.caption, draft.hashtags.join(" "), draft.suggestedCallToAction].join(
    "\n\n",
  );
}

async function prepareImage(
  procedureName: string,
  media: Uint8Array,
  notes: string | undefined,
  enableVision: boolean,
  photoOptions: PhotoOptions,
  clinicId: string,
  isStory = false,
) {
  if (media.byteLength > MAX_IMAGE_BYTES) {
    throw new RequestInputError(400, "FILE_TOO_LARGE", "La imagen supera el máximo de 20 MB.");
  }

  const composition = (async () => {
    const [cleanImage, brand] = await Promise.all([
      removeClinicalBackground(media),
      prisma.brandProfile.findUnique({ where: { id: "default", clinicId } }),
    ]);
    return isStory
      ? renderStoryPhoto({ cleanImage, procedureName, options: photoOptions, brand })
      : overlayOnClinicTemplate({ cleanImage, procedureName, options: photoOptions, brand });
  })();

  if (isStory) {
    return {
      media: await composition,
      generatedCaption: "", educationalCaption: null, commercialCaption: null,
      selectedStyle: "EDUCATIONAL" as const, visualSummary: null, mediaType: "IMAGE" as const,
    };
  }

  const copywriting = (async () => {
    let visualSummary: string | null = null;
    if (enableVision) {
      const reducedJpeg = await sharp(media).rotate().resize(768, 768, { fit: "inside" })
        .jpeg({ quality: 68 }).toBuffer();
      visualSummary = await describeDentalImage(reducedJpeg);
    }

    const context = imageContextFor(procedureName, notes) +
      (visualSummary ? `\nObservaciones visuales no diagnósticas: ${visualSummary}. No las conviertas en afirmaciones clínicas.` : "");
    const variants = await generateDentalVariants(procedureName, context);
    const educationalCaption = buildCaption(variants.educational);
    const commercialCaption = buildCaption(variants.commercial);
    clinicalGuardrails.validate(educationalCaption);
    clinicalGuardrails.validate(commercialCaption);
    return { visualSummary, educationalCaption, commercialCaption };
  })();

  const [composed, { visualSummary, educationalCaption, commercialCaption }] =
    await Promise.all([composition, copywriting]);

  return {
    media: composed, generatedCaption: educationalCaption, educationalCaption,
    commercialCaption, selectedStyle: "EDUCATIONAL" as const,
    visualSummary, mediaType: "IMAGE" as const,
  };
}

async function prepareVideo(
  procedureName: string,
  media: Uint8Array,
  transcript: TranscriptWord[] | undefined,
  notes?: string,
  muteAudio = false,
  isStory = false,
  clinicId = "pilot",
) {
  const vertical = await renderVerticalClinicalVideo(media);
  const captioned = transcript ? await overlayKaraokeSubtitles(vertical, transcript) : vertical;
  const processed = muteAudio ? await muteClinicalVideo(captioned) : captioned;
  const brand = await prisma.brandProfile.findUnique({ where: { id: "default", clinicId } });
  const rendered = await overlayVideoLogo(processed, brand?.logoDataUrl);
  if (isStory) {
    return {
      media: rendered, generatedCaption: "", educationalCaption: null,
      commercialCaption: null, selectedStyle: "EDUCATIONAL" as const,
      visualSummary: null, mediaType: "VIDEO" as const,
    };
  }
  const variants = await generateDentalVariants(
    procedureName,
    videoContextFor(procedureName, transcript !== undefined, notes),
  );
  const educationalCaption = buildCaption(variants.educational);
  const commercialCaption = buildCaption(variants.commercial);
  clinicalGuardrails.validate(educationalCaption);
  clinicalGuardrails.validate(commercialCaption);

  return {
    media: rendered, generatedCaption: educationalCaption, educationalCaption,
    commercialCaption, selectedStyle: "EDUCATIONAL" as const,
    visualSummary: null, mediaType: "VIDEO" as const,
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: readonly string[],
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
    },
    { status },
  );
}

function toErrorResponse(error: unknown) {
  if (error instanceof RequestInputError) {
    return errorResponse(error.status, error.code, error.message);
  }

  if (error instanceof ClinicalGuardrailWarning) {
    return errorResponse(422, "CLINICAL_GUARDRAIL", error.message, error.matches);
  }

  if (error instanceof ImageServiceError) {
    const status =
      error.code === "INVALID_IMAGE" || error.code === "INVALID_PROCEDURE"
        ? 400
        : 422;
    return errorResponse(status, error.code, error.message);
  }

  if (error instanceof VideoServiceError) {
    const status = error.code === "RENDER_FAILED" ? 422 : 400;
    return errorResponse(status, error.code, error.message);
  }

  if (error instanceof AIProviderError) {
    return errorResponse(error.statusCode, "AI_PROVIDER_ERROR", error.message);
  }

  if (error instanceof Error && error.name === "PrismaClientInitializationError") {
    return errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "No se pudo conectar con la base de datos. Revisa DATABASE_URL.",
    );
  }

  if (error instanceof Error && error.name === "PrismaClientKnownRequestError") {
    return errorResponse(
      500,
      "DATABASE_ERROR",
      "No se pudo guardar el post en estado pendiente de aprobación.",
    );
  }

  if (error instanceof TypeError) {
    return errorResponse(400, "INVALID_INPUT", error.message);
  }

  return errorResponse(500, "UNEXPECTED_ERROR", "No se pudo crear el post.");
}

export async function POST(request: Request) {
  const session = await getStudioAccess("content:write");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  let storedMedia: { id: string; kind: MediaKind } | undefined;
  let createdId: string | undefined;

  try {
    const input = await readRequestInput(request);
    const procedureName = resolveProcedureName(input.procedureName);
    const kind = detectMediaKind(input.media);
    if (kind === "image" && input.deliveryFormat !== "STORY" && !input.visionConsent) {
      throw new RequestInputError(
        400, "VISION_CONSENT_REQUIRED",
        "Confirma la autorización para enviar esta fotografía a Google Gemini Vision.",
      );
    }

    if (kind === "image" && (input.transcript || input.muteAudio)) {
      throw new RequestInputError(
        400,
        "INVALID_TRANSCRIPT",
        "La transcripción solo se acepta cuando el archivo es un video.",
      );
    }

    if (kind === "image" && input.deliveryFormat === "REEL" && input.photoOptions.zoom > 1.6) {
      throw new RequestInputError(400, "INVALID_IMAGE", "El encuadre fotográfico no es válido para el Reel.");
    }

    const prepared =
      kind === "image"
        ? await prepareImage(procedureName, input.media, input.notes, input.enableVision ?? false, input.photoOptions, session.clinic.id, input.deliveryFormat === "STORY")
        : await prepareVideo(
            procedureName,
            input.media,
            input.transcript,
            input.notes,
            input.muteAudio,
            input.deliveryFormat === "STORY",
            session.clinic.id,
          );

    const photoReel = kind === "image" && input.deliveryFormat === "REEL";
    const finalMedia = photoReel ? await renderPhotoReel(prepared.media) : prepared.media;
    const finalKind: MediaKind = photoReel ? "video" : kind;
    const finalMediaType = photoReel ? "VIDEO" as const : prepared.mediaType;

    const id = crypto.randomUUID();
    const mediaUrl = `/api/media/${id}`;
    await storePostMedia(id, finalKind, finalMedia);
    storedMedia = { id, kind: finalKind };

    const post = await prisma.scheduledPost.create({
      data: {
        clinicId: session.clinic.id,
        id,
        procedureName,
        mediaType: finalMediaType,
        deliveryFormat: input.deliveryFormat,
        mediaUrl,
        generatedCaption: input.deliveryFormat === "STORY" ? "" : input.selectedStyle === "COMMERCIAL" ? prepared.commercialCaption! : prepared.educationalCaption!,
        educationalCaption: prepared.educationalCaption,
        commercialCaption: prepared.commercialCaption,
        selectedStyle: input.deliveryFormat === "STORY" ? "EDUCATIONAL" : input.selectedStyle,
        visualSummary: prepared.visualSummary,
        status: "PENDING_APPROVAL",
      },
    });
    createdId = post.id;

    return NextResponse.json(
      {
        post: {
          id: post.id,
          procedureName: post.procedureName,
          mediaType: post.mediaType,
          deliveryFormat: post.deliveryFormat,
          mediaUrl: post.mediaUrl,
          generatedCaption: post.generatedCaption,
          educationalCaption: post.educationalCaption,
          commercialCaption: post.commercialCaption,
          selectedStyle: post.selectedStyle,
          visualSummary: post.visualSummary,
          status: post.status,
          createdAt: post.createdAt.toISOString(),
          approvedAt: post.approvedAt?.toISOString() ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (storedMedia && !createdId) {
      await deletePostMedia(storedMedia.id, storedMedia.kind).catch(() => undefined);
    }

    return toErrorResponse(error);
  }
}
