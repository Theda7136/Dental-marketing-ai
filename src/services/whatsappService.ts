/**
 * Notificaciones de aprobación por WhatsApp Business (Cloud API de Meta).
 *
 * Envía el medio del caso y el copy de Grok con dos botones de respuesta.
 * El id del botón es el callback que Meta devuelve en button_reply.id:
 * APPROVE_<post_id> o REJECT_<post_id>.
 *
 * Variables de entorno:
 * - WHATSAPP_ACCESS_TOKEN: token del sistema o del negocio.
 * - WHATSAPP_PHONE_NUMBER_ID: id del número de WhatsApp Business.
 *
 * Meta solo entrega botones interactivos dentro de la ventana de 24 horas
 * desde el último mensaje del doctor.
 */

import { clinicalGuardrails } from "../config/clinicalGuardrails";

const GRAPH_API_VERSION = "v26.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 30_000;
const BODY_MAX_LENGTH = 1_024;
const BUTTON_ID_MAX_LENGTH = 256;

const AUTH_ERROR_CODES = new Set([10, 102, 190]);
const SESSION_CLOSED_CODE = 13_1047;

export type WhatsAppServiceErrorCode =
  | "AUTHENTICATION"
  | "INVALID_PARAMETERS"
  | "SESSION_CLOSED"
  | "API_ERROR";

export class WhatsAppServiceError extends Error {
  readonly code: WhatsAppServiceErrorCode;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: WhatsAppServiceErrorCode,
    statusCode?: number,
  ) {
    super(message);
    this.name = "WhatsAppServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ApprovalNotificationPost {
  id: string;
  procedureName: string;
  mediaUrl: string;
  caption: string;
}

export interface ApprovalNotificationResult {
  messageId: string;
}

type WhatsAppMediaKind = "image" | "video";

interface GraphErrorPayload {
  message?: string;
  type?: string;
  code?: number;
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

function readWhatsAppConfig(): { accessToken: string; phoneNumberId: string } {
  const accessToken = readEnv("WHATSAPP_ACCESS_TOKEN");
  if (!accessToken) {
    throw new WhatsAppServiceError(
      "Falló la autenticación con WhatsApp. Falta la variable de entorno WHATSAPP_ACCESS_TOKEN.",
      "AUTHENTICATION",
    );
  }

  const phoneNumberId = readEnv("WHATSAPP_PHONE_NUMBER_ID");
  if (!phoneNumberId || !/^[0-9]+$/.test(phoneNumberId)) {
    throw new WhatsAppServiceError(
      "El parámetro WHATSAPP_PHONE_NUMBER_ID no está configurado o no es un id numérico válido.",
      "INVALID_PARAMETERS",
    );
  }

  return { accessToken, phoneNumberId };
}

function normalizeDoctorPhone(doctorPhone: string): string {
  if (typeof doctorPhone !== "string") {
    throw new TypeError("doctorPhone debe ser un string.");
  }

  const digits = doctorPhone.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new WhatsAppServiceError(
      "El teléfono del doctor debe incluir el código de país, sin espacios ni símbolos.",
      "INVALID_PARAMETERS",
    );
  }

  return digits;
}

function assertPostData(postData: ApprovalNotificationPost): ApprovalNotificationPost {
  if (typeof postData !== "object" || postData === null) {
    throw new TypeError("postData debe incluir el caso que se va a notificar.");
  }

  const id = typeof postData.id === "string" ? postData.id.trim() : "";
  const procedureName =
    typeof postData.procedureName === "string" ? postData.procedureName.trim() : "";
  const mediaUrl = typeof postData.mediaUrl === "string" ? postData.mediaUrl.trim() : "";
  const caption = typeof postData.caption === "string" ? postData.caption.trim() : "";

  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new WhatsAppServiceError(
      "El id del post no es válido para el callback de WhatsApp.",
      "INVALID_PARAMETERS",
    );
  }

  if (procedureName.length === 0 || caption.length === 0) {
    throw new WhatsAppServiceError(
      "El procedimiento y el texto del post son obligatorios.",
      "INVALID_PARAMETERS",
    );
  }

  clinicalGuardrails.validate(procedureName);
  clinicalGuardrails.validate(caption);

  return { id, procedureName, mediaUrl, caption };
}

function assertPublicMediaUrl(mediaUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    throw new WhatsAppServiceError(
      "La URL del medio no es válida. WhatsApp necesita un enlace HTTPS público.",
      "INVALID_PARAMETERS",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    parsed.protocol !== "https:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local");

  if (isLocal) {
    throw new WhatsAppServiceError(
      "WhatsApp no puede descargar un medio local. Publica la imagen o el video en una URL HTTPS.",
      "INVALID_PARAMETERS",
    );
  }

  return parsed;
}

function extensionOf(url: URL): string {
  const path = url.pathname.toLowerCase();
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : "";
}

function kindFromHint(hint: string): WhatsAppMediaKind | undefined {
  const value = hint.toLowerCase().split(";")[0]?.trim() ?? "";
  if (value === "image/jpeg" || value === "image/png" || value === "jpg" || value === "jpeg" || value === "png") {
    return "image";
  }
  if (value === "video/mp4" || value === "mp4") {
    return "video";
  }
  if (
    value === "image/webp" ||
    value === "video/webm" ||
    value === "video/quicktime" ||
    value === "webp" ||
    value === "webm" ||
    value === "mov" ||
    value === "m4v" ||
    value === "gif"
  ) {
    throw new WhatsAppServiceError(
      "WhatsApp solo acepta imágenes JPEG o PNG, y videos MP4, en el mensaje de aprobación.",
      "INVALID_PARAMETERS",
    );
  }
  return undefined;
}

async function detectMediaKind(url: URL): Promise<WhatsAppMediaKind> {
  const fromExtension = kindFromHint(extensionOf(url));
  if (fromExtension) {
    return fromExtension;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new WhatsAppServiceError(
      "No se pudo identificar si el medio es imagen o video. Usa una URL HTTPS que termine en .jpg, .png o .mp4.",
      "INVALID_PARAMETERS",
    );
  }

  const fromHeader = kindFromHint(response.headers.get("content-type") ?? "");
  if (!response.ok || !fromHeader) {
    throw new WhatsAppServiceError(
      "No se pudo identificar si el medio es imagen o video. Usa una URL HTTPS que termine en .jpg, .png o .mp4.",
      "INVALID_PARAMETERS",
    );
  }

  return fromHeader;
}

function buildBody(procedureName: string, caption: string): string {
  const text = `${procedureName}\n\n${caption}`;
  if (text.length > BODY_MAX_LENGTH) {
    throw new WhatsAppServiceError(
      `El texto supera los ${BODY_MAX_LENGTH} caracteres que acepta un mensaje con botones de WhatsApp.`,
      "INVALID_PARAMETERS",
    );
  }
  return text;
}

function buttonId(action: "APPROVE" | "REJECT", postId: string): string {
  const id = `${action}_${postId}`;
  if (id.length > BUTTON_ID_MAX_LENGTH) {
    throw new WhatsAppServiceError(
      "El callback del botón supera el límite de WhatsApp.",
      "INVALID_PARAMETERS",
    );
  }
  return id;
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

function toWhatsAppError(payload: unknown, status: number): WhatsAppServiceError {
  const graphError = readGraphError(payload);
  const code = graphError?.code;
  const isAuthError =
    status === 401 ||
    status === 403 ||
    graphError?.type === "OAuthException" ||
    (code !== undefined &&
      (AUTH_ERROR_CODES.has(code) || (code >= 200 && code <= 299)));

  if (isAuthError) {
    return new WhatsAppServiceError(
      "Falló la autenticación con WhatsApp. El token es inválido, venció o no tiene permiso para enviar mensajes.",
      "AUTHENTICATION",
      status,
    );
  }

  if (code === SESSION_CLOSED_CODE) {
    return new WhatsAppServiceError(
      "WhatsApp no entregó los botones porque pasaron más de 24 horas desde el último mensaje del doctor.",
      "SESSION_CLOSED",
      status,
    );
  }

  if (code === 100) {
    return new WhatsAppServiceError(
      "WhatsApp rechazó los parámetros del mensaje. Revisa el teléfono, la URL pública del medio y el texto.",
      "INVALID_PARAMETERS",
      status,
    );
  }

  return new WhatsAppServiceError(
    "WhatsApp no pudo enviar la notificación de aprobación.",
    "API_ERROR",
    status,
  );
}

async function sendInteractiveMessage(
  phoneNumberId: string,
  accessToken: string,
  payload: unknown,
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new WhatsAppServiceError(
      "No se pudo contactar la API de WhatsApp.",
      "API_ERROR",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WhatsAppServiceError(
      "WhatsApp devolvió una respuesta que no es JSON.",
      "API_ERROR",
      response.status,
    );
  }

  if (!response.ok) {
    throw toWhatsAppError(body, response.status);
  }

  const messages = isRecord(body) ? body.messages : undefined;
  const first = Array.isArray(messages) ? messages[0] : undefined;
  const messageId =
    isRecord(first) && typeof first.id === "string" ? first.id.trim() : "";

  if (messageId.length === 0) {
    throw new WhatsAppServiceError(
      "WhatsApp no devolvió el identificador del mensaje enviado.",
      "API_ERROR",
    );
  }

  return messageId;
}

/**
 * Envía al doctor el medio del caso, el texto de Grok y los botones Aprobar y Rechazar.
 *
 * @throws {TypeError} si el teléfono o postData no tienen la forma esperada.
 * @throws {WhatsAppServiceError} si falla la autenticación, los parámetros o la API de Meta.
 * @throws {ClinicalGuardrailWarning} si el texto contiene una frase clínica prohibida.
 */
export async function sendApprovalNotification(
  doctorPhone: string,
  postData: ApprovalNotificationPost,
): Promise<ApprovalNotificationResult> {
  const phone = normalizeDoctorPhone(doctorPhone);
  const post = assertPostData(postData);
  const mediaUrl = assertPublicMediaUrl(post.mediaUrl);

  try {
    const kind = await detectMediaKind(mediaUrl);
    const { accessToken, phoneNumberId } = readWhatsAppConfig();
    const header =
      kind === "video"
        ? { type: "video" as const, video: { link: mediaUrl.toString() } }
        : { type: "image" as const, image: { link: mediaUrl.toString() } };

    const messageId = await sendInteractiveMessage(phoneNumberId, accessToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "interactive",
      interactive: {
        type: "button",
        header,
        body: { text: buildBody(post.procedureName, post.caption) },
        footer: { text: "Revisión clínica" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: buttonId("APPROVE", post.id), title: "Aprobar" },
            },
            {
              type: "reply",
              reply: { id: buttonId("REJECT", post.id), title: "Rechazar" },
            },
          ],
        },
      },
    });

    return { messageId };
  } catch (error) {
    if (
      error instanceof WhatsAppServiceError ||
      error instanceof TypeError
    ) {
      throw error;
    }

    throw new WhatsAppServiceError(
      "No se pudo enviar la notificación de aprobación por WhatsApp.",
      "API_ERROR",
    );
  }
}
