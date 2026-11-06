/**
 * Publicación de posts en Instagram mediante la Graph API de Meta.
 *
 * Flujo oficial de dos pasos para una cuenta profesional:
 * 1. POST /{ig-user-id}/media crea el contenedor con la imagen y el caption.
 * 2. Cuando status_code es FINISHED, POST /{ig-user-id}/media_publish lo publica.
 *
 * Variables de entorno:
 * - INSTAGRAM_PAGE_ACCESS_TOKEN: token de acceso de la página vinculada.
 * - INSTAGRAM_BUSINESS_ACCOUNT_ID: id de la cuenta profesional de Instagram.
 */

import { clinicalGuardrails } from "../config/clinicalGuardrails";

const GRAPH_API_VERSION = "v26.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 30_000;
const CAPTION_MAX_LENGTH = 2_200;
const CONTAINER_STATUS_ATTEMPTS = 8;
const CONTAINER_STATUS_DELAY_MS = 2_000;

const AUTH_ERROR_CODES = new Set([10, 102, 190]);

export type InstagramServiceErrorCode =
  | "AUTHENTICATION"
  | "INVALID_PARAMETERS"
  | "CONTAINER_NOT_READY"
  | "API_ERROR";

export class InstagramServiceError extends Error {
  readonly code: InstagramServiceErrorCode;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: InstagramServiceErrorCode,
    statusCode?: number,
  ) {
    super(message);
    this.name = "InstagramServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface InstagramPublishResult {
  containerId: string;
  mediaId: string;
}

interface GraphErrorPayload {
  message?: string;
  type?: string;
  code?: number;
}

interface GraphErrorResponse {
  error?: GraphErrorPayload;
}

interface MediaContainerResponse {
  id?: string;
}

interface ContainerStatusResponse {
  id?: string;
  status_code?: string;
}

interface MediaPublishResponse {
  id?: string;
}

function readEnv(name: string): string | undefined {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;

  const value = env?.[name]?.trim();
  return value ? value : undefined;
}

function readInstagramConfig(): { accessToken: string; igUserId: string } {
  const accessToken = readEnv("INSTAGRAM_PAGE_ACCESS_TOKEN");
  if (!accessToken) {
    throw new InstagramServiceError(
      "Falló la autenticación con Instagram. Falta la variable de entorno INSTAGRAM_PAGE_ACCESS_TOKEN.",
      "AUTHENTICATION",
    );
  }

  const igUserId = readEnv("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  if (!igUserId || !/^[0-9]+$/.test(igUserId)) {
    throw new InstagramServiceError(
      "El parámetro INSTAGRAM_BUSINESS_ACCOUNT_ID no está configurado o no es un id numérico válido.",
      "INVALID_PARAMETERS",
    );
  }

  return { accessToken, igUserId };
}

function assertCaption(caption: string): string {
  if (typeof caption !== "string") {
    throw new TypeError("caption debe ser un string.");
  }

  const trimmed = caption.trim();
  if (trimmed.length === 0) {
    throw new InstagramServiceError(
      "El caption está vacío. Instagram no acepta una publicación sin texto.",
      "INVALID_PARAMETERS",
    );
  }

  if (trimmed.length > CAPTION_MAX_LENGTH) {
    throw new InstagramServiceError(
      `El caption supera los ${CAPTION_MAX_LENGTH} caracteres que acepta Instagram.`,
      "INVALID_PARAMETERS",
    );
  }

  clinicalGuardrails.validate(trimmed);
  return trimmed;
}

function assertImageUrl(imageUrl: string): string {
  if (typeof imageUrl !== "string") {
    throw new TypeError("imageUrl debe ser un string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl.trim());
  } catch {
    throw new InstagramServiceError(
      "La URL de la imagen no es válida.",
      "INVALID_PARAMETERS",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new InstagramServiceError(
      "La imagen debe publicarse desde una URL HTTPS pública. Instagram no puede descargar otros protocolos.",
      "INVALID_PARAMETERS",
    );
  }

  return parsed.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readGraphError(payload: unknown): GraphErrorPayload | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  const error = payload.error;
  return {
    message: typeof error.message === "string" ? error.message : undefined,
    type: typeof error.type === "string" ? error.type : undefined,
    code: typeof error.code === "number" ? error.code : undefined,
  };
}

function safeMetaDetail(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length === 0 || compact.length > 180 || /EAA[A-Za-z0-9]/.test(compact)) {
    return undefined;
  }

  return compact;
}

function toInstagramError(
  payload: unknown,
  status: number,
): InstagramServiceError {
  const graphError = readGraphError(payload);
  const code = graphError?.code;
  const isAuthError =
    status === 401 ||
    status === 403 ||
    graphError?.type === "OAuthException" ||
    (code !== undefined &&
      (AUTH_ERROR_CODES.has(code) || (code >= 200 && code <= 299)));

  if (isAuthError) {
    return new InstagramServiceError(
      "Falló la autenticación con Instagram. El token de acceso de la página es inválido, venció o no tiene permiso para publicar.",
      "AUTHENTICATION",
      status,
    );
  }

  if (code === 100) {
    const detail = safeMetaDetail(graphError?.message);
    return new InstagramServiceError(
      detail
        ? `Instagram rechazó los parámetros de la publicación: ${detail}`
        : "Instagram rechazó los parámetros de la publicación. Revisa la URL de la imagen y el caption.",
      "INVALID_PARAMETERS",
      status,
    );
  }

  return new InstagramServiceError(
    "Instagram no pudo completar la publicación.",
    "API_ERROR",
    status,
  );
}

async function graphRequest(
  path: string,
  accessToken: string,
  body?: URLSearchParams,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${GRAPH_API_BASE}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new InstagramServiceError(
      "No se pudo contactar la API de Instagram.",
      "API_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as GraphErrorResponse;
  } catch {
    throw new InstagramServiceError(
      "Instagram devolvió una respuesta que no es JSON.",
      "API_ERROR",
      response.status,
    );
  }

  if (!response.ok) {
    throw toInstagramError(payload, response.status);
  }

  return payload;
}

function readId(payload: unknown, label: string): string {
  if (!isRecord(payload) || typeof payload.id !== "string" || payload.id.trim().length === 0) {
    throw new InstagramServiceError(
      `Instagram no devolvió el identificador de ${label}.`,
      "API_ERROR",
    );
  }

  return payload.id;
}

async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const body = new URLSearchParams({
    image_url: imageUrl,
    caption,
  });

  try {
    const payload = (await graphRequest(
      `${igUserId}/media`,
      accessToken,
      body,
    )) as MediaContainerResponse;

    return readId(payload, "el contenedor");
  } catch (error) {
    if (error instanceof InstagramServiceError || error instanceof TypeError) {
      throw error;
    }

    throw new InstagramServiceError(
      "No se pudo crear el contenedor de medios en Instagram.",
      "API_ERROR",
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntilContainerReady(
  containerId: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 1; attempt <= CONTAINER_STATUS_ATTEMPTS; attempt += 1) {
    let payload: ContainerStatusResponse;

    try {
      payload = (await graphRequest(
        `${encodeURIComponent(containerId)}?fields=status_code`,
        accessToken,
      )) as ContainerStatusResponse;
    } catch (error) {
      if (error instanceof InstagramServiceError || error instanceof TypeError) {
        throw error;
      }

      throw new InstagramServiceError(
        "No se pudo consultar el estado del contenedor de Instagram.",
        "API_ERROR",
      );
    }

    const status = payload.status_code;

    if (status === "FINISHED") {
      return;
    }

    if (status === "ERROR") {
      throw new InstagramServiceError(
        "Instagram no pudo procesar la imagen del contenedor. Revisa que la URL sea pública y que el archivo sea una imagen válida.",
        "INVALID_PARAMETERS",
      );
    }

    if (status === "EXPIRED") {
      throw new InstagramServiceError(
        "El contenedor de Instagram expiró antes de poder publicarse.",
        "CONTAINER_NOT_READY",
      );
    }

    if (status === "PUBLISHED") {
      throw new InstagramServiceError(
        "El contenedor de Instagram ya estaba publicado.",
        "API_ERROR",
      );
    }

    if (attempt < CONTAINER_STATUS_ATTEMPTS) {
      await delay(CONTAINER_STATUS_DELAY_MS);
    }
  }

  throw new InstagramServiceError(
    "El contenedor de Instagram no estuvo listo para publicarse.",
    "CONTAINER_NOT_READY",
  );
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
): Promise<string> {
  const body = new URLSearchParams({
    creation_id: containerId,
  });

  try {
    const payload = (await graphRequest(
      `${igUserId}/media_publish`,
      accessToken,
      body,
    )) as MediaPublishResponse;

    return readId(payload, "la publicación");
  } catch (error) {
    if (error instanceof InstagramServiceError || error instanceof TypeError) {
      throw error;
    }

    throw new InstagramServiceError(
      "No se pudo publicar el contenedor en Instagram.",
      "API_ERROR",
    );
  }
}

/**
 * Publica una imagen en la cuenta profesional de Instagram.
 *
 * @throws {TypeError} si imageUrl o caption no son strings.
 * @throws {InstagramServiceError} si falla la autenticación, los parámetros o la API.
 * @throws {ClinicalGuardrailWarning} si el caption contiene una frase clínica prohibida.
 */
export async function publishPostToInstagram(
  imageUrl: string,
  caption: string,
): Promise<InstagramPublishResult> {
  const safeImageUrl = assertImageUrl(imageUrl);
  const safeCaption = assertCaption(caption);
  const { accessToken, igUserId } = readInstagramConfig();

  try {
    const containerId = await createMediaContainer(
      igUserId,
      accessToken,
      safeImageUrl,
      safeCaption,
    );
    await waitUntilContainerReady(containerId, accessToken);
    const mediaId = await publishContainer(igUserId, accessToken, containerId);

    return { containerId, mediaId };
  } catch (error) {
    if (error instanceof InstagramServiceError || error instanceof TypeError) {
      throw error;
    }

    throw new InstagramServiceError(
      "No se pudo publicar el post en Instagram.",
      "API_ERROR",
    );
  }
}
