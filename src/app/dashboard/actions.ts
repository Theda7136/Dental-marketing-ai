"use server";

import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";
import { publishToMeta } from "@/lib/metaPublish";
import { publishToTikTok } from "@/lib/tiktokPublisher";
import { inspectMetaObject } from "@/lib/metaVerification";
import { generateDentalVariants } from "@/services/aiProvider";
import { createSignedMediaUrl } from "@/lib/mediaSignature";
import { canEditUnsentProposal, canSendToNetwork, canStartInitialPublication } from "@/lib/metaDeliveryPolicy.mjs";

async function generateCaptionWithAI(procedureName: string, notes: string) {
  if (!clinicalGuardrails.allowedDentalTerms.some((term) => term === procedureName)) {
    throw new Error("Selecciona un procedimiento odontológico permitido.");
  }
  const context = notes?.trim().slice(0, 800) || "Sin notas confirmadas.";
  clinicalGuardrails.validate(context);
  const { educational } = await generateDentalVariants(procedureName, context);
  const caption = [
    educational.caption,
    educational.hashtags.join(" "),
    educational.suggestedCallToAction,
  ].join("\n\n");
  clinicalGuardrails.validate(caption);
  return caption;
}

export async function createMarketingProposal(formData: FormData) {
  const access = await getStudioAccess("content:write");
  if (!access) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const procedureName = formData.get("procedureName") as string;
    const notes = formData.get("notes") as string;
    const file = formData.get("photo") as File;

    if (!procedureName) {
      return { ok: false, message: "El procedimiento es obligatorio." };
    }

    let mediaUrl = "https://via.placeholder.com/600";

    if (file && file.size > 0) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64 = buffer.toString("base64");
      mediaUrl = `data:${file.type};base64,${base64}`;
    }

    // Genera el texto dinámico usando Grok
    const generatedCaption = await generateCaptionWithAI(procedureName, notes);

    const newPost = {
      id: Math.random().toString(36).substring(2, 9),
      procedureName,
      generatedCaption,
      mediaUrl,
      status: "PENDING_APPROVAL" as const,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, post: newPost };
  } catch (error: any) {
    console.error("Error al crear propuesta:", error);
    return { ok: false, message: error.message || "Error al generar la propuesta." };
  }
}

export async function createTextProposal(formData: FormData) {
  const access = await getStudioAccess("content:write");
  if (!access) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const procedureName = formData.get("procedureName") as string;
    const notes = formData.get("notes") as string;
    const selectedStyle = formData.get("selectedStyle");
    if (selectedStyle !== "EDUCATIONAL" && selectedStyle !== "COMMERCIAL") {
      return { ok: false, message: "Elige una versión educativa o comercial." };
    }

    if (!procedureName) {
      return { ok: false, message: "El procedimiento es obligatorio." };
    }

    if (!clinicalGuardrails.allowedDentalTerms.some((term) => term === procedureName)) {
      return { ok: false, message: "Elige un procedimiento odontológico permitido." };
    }

    clinicalGuardrails.validate(notes);

    const variants = await generateDentalVariants(
      procedureName,
      `Idea de contenido basada exclusivamente en la descripción facilitada por la clínica: ${notes || "Sin notas adicionales"}. No inventes características del paciente ni resultados.`,
    );
    const toCaption = (draft: { caption: string; hashtags: string[]; suggestedCallToAction: string }) =>
      [draft.caption, draft.hashtags.join(" "), draft.suggestedCallToAction].join("\n\n");
    const educationalCaption = toCaption(variants.educational);
    const commercialCaption = toCaption(variants.commercial);
    clinicalGuardrails.validate(educationalCaption);
    clinicalGuardrails.validate(commercialCaption);

    const post = await prisma.scheduledPost.create({
      data: {
        clinicId: access.clinic.id,
        procedureName,
        mediaType: "IMAGE",
        generatedCaption: selectedStyle === "COMMERCIAL" ? commercialCaption : educationalCaption,
        educationalCaption,
        commercialCaption,
        selectedStyle,
        mediaUrl: "",
        status: "PENDING_APPROVAL",
      },
    });

    return {
      ok: true,
      post: {
        ...post,
        createdAt: post.createdAt.toISOString(),
        approvedAt: post.approvedAt?.toISOString() ?? null,
        scheduledFor: post.scheduledFor?.toISOString() ?? null,
        clinicalVerifiedAt: post.clinicalVerifiedAt?.toISOString() ?? null,
        facebookReviewedAt: post.facebookReviewedAt?.toISOString() ?? null,
        instagramReviewedAt: post.instagramReviewedAt?.toISOString() ?? null,
        deliveryFormat: "FEED" as const,
        mediaKind: "text" as const,
      },
    };
  } catch (error: any) {
    console.error("Error al crear texto:", error);
    return { ok: false, message: error.message || "Error al generar el texto." };
  }
}

export async function chooseCopyStyle(postId: string, style: "EDUCATIONAL" | "COMMERCIAL") {
  const access = await getStudioAccess("content:write");
  if (!access) return { ok: false, message: "Inicia sesión para editar propuestas." };
  if (style !== "EDUCATIONAL" && style !== "COMMERCIAL") {
    return { ok: false, message: "Estilo de contenido no válido." };
  }

  const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
  if (!post || post.status !== "PENDING_APPROVAL" || post.tiktokStatus !== "PENDING" || !canEditUnsentProposal(post) || post.facebookRetryCount > 0 || post.instagramRetryCount > 0) {
    return { ok: false, message: "La propuesta ya inició su publicación o no está pendiente." };
  }

  const caption = style === "EDUCATIONAL" ? post.educationalCaption : post.commercialCaption;
  if (!caption) return { ok: false, message: "Esta propuesta no tiene generada esa versión de texto." };

  try {
    clinicalGuardrails.validate(caption);
    const saved = await prisma.scheduledPost.updateMany({
      where: {
        id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL",
        facebookStatus: "PENDING", instagramStatus: "PENDING",
        tiktokStatus: "PENDING",
      },
      data: { selectedStyle: style, generatedCaption: caption, clinicalVerifiedAt: null },
    });

    return saved.count === 1
      ? { ok: true, caption, style }
      : { ok: false, message: "La propuesta cambió de estado; recarga la página." };
  } catch {
    return { ok: false, message: "No se pudo seleccionar esta versión." };
  }
}

export async function updatePendingCaption(postId: string, caption: string) {
  const access = await getStudioAccess("content:write");
  if (!access) {
    return { ok: false, message: "Inicia sesión para editar propuestas." };
  }

  const revisedCaption = caption.trim();
  if (!revisedCaption || revisedCaption.length > 2200) {
    return { ok: false, message: "El texto debe tener entre 1 y 2200 caracteres." };
  }

  try {
    clinicalGuardrails.validate(revisedCaption);
    const currentPost = await prisma.scheduledPost.findUnique({
      where: { id: postId, clinicId: access.clinic.id },
      select: { facebookStatus: true, instagramStatus: true, tiktokStatus: true, selectedStyle: true, facebookRetryCount: true, instagramRetryCount: true },
    });
    if (!currentPost || currentPost.tiktokStatus !== "PENDING" || !canEditUnsentProposal(currentPost) || currentPost.facebookRetryCount > 0 || currentPost.instagramRetryCount > 0) {
      return { ok: false, message: "No puedes modificar el texto después de iniciar la publicación." };
    }
    const updated = await prisma.scheduledPost.updateMany({
      where: { id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL", facebookStatus: "PENDING", instagramStatus: "PENDING", tiktokStatus: "PENDING" },
      data: {
        generatedCaption: revisedCaption,
        clinicalVerifiedAt: null,
        ...(currentPost.selectedStyle === "COMMERCIAL"
          ? { commercialCaption: revisedCaption }
          : { educationalCaption: revisedCaption }),
      },
    });

    return updated.count === 1
      ? { ok: true, caption: revisedCaption }
      : { ok: false, message: "La propuesta ya fue enviada a publicación o dejó de estar pendiente. No puedes modificar el texto." };
  } catch (error) {
    console.error("Error al guardar el texto de la propuesta:", error);
    return { ok: false, message: "No se pudo guardar el texto. Revisa el contenido e inténtalo nuevamente." };
  }
}

type ApproveAndPublishResult =
  | { ok: true; approvedAt: string; warnings?: string[]; instagramId?: string; facebookId?: string }
  | { ok: false; message: string };

export async function approveAndPublishPost(
  postId: string,
): Promise<ApproveAndPublishResult> {
  const access = await getStudioAccess("content:publish");
  if (!access) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
    if (!post || post.status !== "PENDING_APPROVAL") {
      return { ok: false, message: "La publicación ya no está pendiente de aprobación." };
    }
    if (!post.mediaUrl) {
      return { ok: false, message: "Las ideas de texto no se pueden publicar como una imagen." };
    }
    if (post.facebookRetryCount > 0 || post.instagramRetryCount > 0) {
      return { ok: false, message: "Este registro ya tuvo un intento incierto. Publica únicamente en la red autorizada para reintento." };
    }
    if (!canStartInitialPublication(post)) {
      return { ok: false, message: "Una red ya tiene un envío iniciado o confirmado. Consulta el historial; solo es seguro enviar a una red pendiente." };
    }
    const confirmed = await prisma.scheduledPost.updateMany({
      where: {
        id: post.id,
        clinicId: access.clinic.id,
        status: "PENDING_APPROVAL",
        archivedAt: null,
        facebookStatus: "PENDING",
        instagramStatus: "PENDING",
        facebookRetryCount: 0,
        instagramRetryCount: 0,
      },
      data: { clinicalVerifiedAt: new Date() },
    });
    if (confirmed.count !== 1) {
      return { ok: false, message: "La publicación cambió de estado. Actualiza Pendientes antes de aprobar." };
    }
    const result = await publishToMeta({
      id: post.id,
      mediaUrl: post.mediaUrl,
      generatedCaption: post.generatedCaption,
      mediaKind: post.mediaType === "VIDEO" ? "video" : "image",
    });
    const approvedAt = new Date();
    await prisma.scheduledPost.update({
      where: { id: post.id, clinicId: access.clinic.id },
      data: { status: "PUBLISHED", approvedAt },
    });

    return {
      ok: true,
      approvedAt: approvedAt.toISOString(),
      ...(result.instagramId ? { instagramId: result.instagramId } : {}),
      ...(result.facebookId ? { facebookId: result.facebookId } : {}),
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    };
  } catch (error: any) {
    console.error("Error al publicar en redes:", error);
    return { ok: false, message: error.message || "Error desconocido al publicar." };
  }
}

export async function retryPendingNetwork(
  postId: string,
  network: "facebook" | "instagram",
): Promise<{ ok: boolean; message: string; notSent?: boolean }> {
  const access = await getStudioAccess("content:publish");
  if (!access) {
    return { ok: false, notSent: true, message: "Inicia sesión para publicar." };
  }

  try {
    const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
    if (!post || !["PENDING_APPROVAL", "PUBLISHED"].includes(post.status)) {
      return { ok: false, notSent: true, message: "La propuesta ya no admite publicaciones." };
    }
    if (!post.mediaUrl) {
      return { ok: false, notSent: true, message: "Las ideas de texto no se pueden enviar como imágenes." };
    }

    const networkStatus = network === "facebook" ? post.facebookStatus : post.instagramStatus;
    if (!canSendToNetwork(networkStatus)) {
      return {
        ok: false,
        notSent: false,
        message: "Esta red ya fue utilizada o tiene un resultado incierto. Verifica el estado en Meta antes de continuar.",
      };
    }

    if (!post.clinicalVerifiedAt) {
      const confirmed = await prisma.scheduledPost.updateMany({
        where: { id: post.id, clinicId: access.clinic.id, archivedAt: null, clinicalVerifiedAt: null },
        data: { clinicalVerifiedAt: new Date() },
      });
      if (confirmed.count !== 1) {
        return { ok: false, notSent: true, message: "No se pudo registrar la aprobación. Actualiza el panel." };
      }
    }

    const result = await publishToMeta({
      id: post.id,
      mediaUrl: post.mediaUrl,
      generatedCaption: post.generatedCaption,
      mediaKind: post.mediaType === "VIDEO" ? "video" : "image",
    }, network);

    const publishedId = network === "facebook" ? result.facebookId : result.instagramId;
    if (!publishedId) {
      return { ok: false, message: "Meta no confirmó el envío. Verifica la red antes de otro intento." };
    }

    if (post.status === "PENDING_APPROVAL") {
      await prisma.scheduledPost.update({
        where: { id: post.id, clinicId: access.clinic.id },
        data: { status: "PUBLISHED", approvedAt: new Date() },
      });
    }

    const platform = network === "facebook" ? "Facebook" : "Instagram";
    return {
      ok: true,
      message: `Publicación confirmada en ${platform}.` +
        (result.warnings?.length ? " " + result.warnings.join(" ") : ""),
    };
  } catch (error) {
    console.error("Error al publicar en la red pendiente:", error);
    const current = await prisma.scheduledPost.findUnique({
      where: { id: postId, clinicId: access.clinic.id },
      select: { facebookStatus: true, instagramStatus: true },
    }).catch(() => null);
    const status = network === "facebook" ? current?.facebookStatus : current?.instagramStatus;
    if (status === "PENDING") {
      return {
        ok: false,
        notSent: true,
        message: error instanceof Error ? error.message : "No se pudo iniciar la publicación.",
      };
    }
    return {
      ok: false,
      message: "No se confirmó la publicación. Comprueba el estado en Meta antes de otro intento.",
    };
  }
}

export async function checkPublicMediaAccess(postId: string): Promise<{ ok: boolean; message: string }> {
  const access = await getStudioAccess("content:read");
  if (!access) {
    return { ok: false, message: "Inicia sesión para comprobar el archivo." };
  }

  const baseUrl = process.env.META_PUBLIC_MEDIA_URL;
  if (!baseUrl) {
    return { ok: false, message: "Configura META_PUBLIC_MEDIA_URL con el túnel HTTPS de Cloudflare." };
  }

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { ok: false, message: "META_PUBLIC_MEDIA_URL no es una dirección válida." };
  }

  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".trycloudflare.com")) {
    return { ok: false, message: "Para esta comprobación local utiliza una URL HTTPS de trycloudflare.com." };
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId, clinicId: access.clinic.id },
    select: { mediaUrl: true, mediaType: true, status: true },
  });

  if (!post?.mediaUrl || post.status !== "PENDING_APPROVAL" || post.mediaType !== "IMAGE") {
    return { ok: false, message: "Selecciona una propuesta de fotografía pendiente para comprobar el acceso." };
  }

  try {
    const response = await fetch(createSignedMediaUrl(postId, origin.origin), {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.status !== 200 || !contentType.startsWith("image/")) {
      await response.body?.cancel();
      return {
        ok: false,
        message: `Cloudflare devolvió HTTP ${response.status} (${contentType || "sin tipo de archivo"}). Comprueba que el túnel y Next.js estén activos.`,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) return { ok: false, message: "La respuesta no contiene una imagen descargable." };

    const firstChunk = await reader.read();
    await reader.cancel();
    if (firstChunk.done || !firstChunk.value.length) {
      return { ok: false, message: "El servidor devolvió una imagen vacía." };
    }

    return {
      ok: true,
      message: "Acceso HTTPS comprobado: la imagen respondió correctamente sin autenticación Basic. Aún falta validar la publicación con Meta.",
    };
  } catch (error) {
    console.error("Fallo comprobando la URL pública de medios:", error);
    return {
      ok: false,
      message: "No fue posible descargar la imagen por HTTPS. Comprueba que Cloudflare siga activo y que META_PUBLIC_MEDIA_URL coincida con su dirección.",
    };
  }
}

export async function verifyMetaObject(postId: string, network: "facebook" | "instagram") {
  const access = await getStudioAccess("content:review");
  if (!access) {
    return { ok: false as const, message: "Inicia sesión para consultar Meta." };
  }

  try {
    return await inspectMetaObject(postId, network);
  } catch (error) {
    console.error("Error consultando objeto de Meta:", error);
    return { ok: false as const, message: "No se pudo comprobar el identificador de publicación." };
  }
}

export async function recordDeliveryReview(
  postId: string,
  network: "facebook" | "instagram",
  outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN",
  evidence: string,
): Promise<{ ok: boolean; message: string }> {
  const access = await getStudioAccess("content:review");
  if (!access) {
    return { ok: false, message: "Inicia sesión para registrar verificaciones." };
  }

  const note = evidence.trim();
  if (!note || note.length > 1000) {
    return { ok: false, message: "Describe la comprobación realizada (1 a 1000 caracteres)." };
  }

  if (!["facebook", "instagram"].includes(network) || !["FOUND", "NOT_FOUND", "UNCERTAIN"].includes(outcome)) {
    return { ok: false, message: "El resultado de verificación no es válido." };
  }

  try {
    const statusField = network === "facebook" ? "facebookStatus" : "instagramStatus";
    const where = { id: postId, clinicId: access.clinic.id, [statusField]: { in: ["UNKNOWN", "IN_PROGRESS"] } };
    const reviewedAt = new Date();
    const data = network === "facebook"
      ? { facebookReviewOutcome: outcome, facebookReviewEvidence: note, facebookReviewedAt: reviewedAt }
      : { instagramReviewOutcome: outcome, instagramReviewEvidence: note, instagramReviewedAt: reviewedAt };

    const updated = await prisma.scheduledPost.updateMany({ where, data });
    if (updated.count !== 1) {
      return { ok: false, message: "Esta red ya no requiere verificación manual o el registro no existe." };
    }

    return {
      ok: true,
      message: "Verificación registrada. El envío permanece bloqueado hasta completar una conciliación segura con Meta.",
    };
  } catch (error) {
    console.error("No se pudo guardar la revisión de publicación:", error);
    return { ok: false, message: "No se pudo guardar la verificación. Inténtalo nuevamente." };
  }
}

export async function authorizeManualRetry(
  postId: string,
  network: "facebook" | "instagram",
): Promise<{ ok: boolean; message: string }> {
  const access = await getStudioAccess("content:publish");
  if (!access) return { ok: false, message: "Inicia sesión para continuar." };
  if (network !== "facebook" && network !== "instagram") {
    return { ok: false, message: "Red social no válida." };
  }

  const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
  if (!post || !post.mediaUrl || post.status !== "PENDING_APPROVAL") {
    return { ok: false, message: "La propuesta no está pendiente de aprobación." };
  }

  const status = network === "facebook" ? post.facebookStatus : post.instagramStatus;
  const outcome = network === "facebook" ? post.facebookReviewOutcome : post.instagramReviewOutcome;
  const reviewedAt = network === "facebook" ? post.facebookReviewedAt : post.instagramReviewedAt;
  const objectId = network === "facebook" ? post.facebookPostId : post.instagramPostId;
  const notes = network === "facebook" ? post.facebookReviewEvidence : post.instagramReviewEvidence;
  const retries = network === "facebook" ? post.facebookRetryCount : post.instagramRetryCount;

  if (status !== "UNKNOWN" || outcome !== "NOT_FOUND" || objectId || !notes || !reviewedAt) {
    return {
      ok: false,
      message: "Antes de reintentar debes comprobar la red, registrar que no encontraste la publicación y conservar la evidencia. Si existe un ID de Meta, resuélvelo primero.",
    };
  }
  if (Date.now() - reviewedAt.getTime() > 30 * 60 * 1000) {
    return { ok: false, message: "La comprobación tiene más de 30 minutos. Verifica nuevamente la red." };
  }
  if (retries >= 1) {
    return { ok: false, message: "Ya se autorizó un reintento manual. Requiere revisión técnica para evitar duplicados." };
  }

  const fields = network === "facebook"
    ? {
      facebookStatus: "PENDING",
      facebookRetryCount: { increment: 1 },
      facebookLastRetryAt: new Date(),
    }
    : {
      instagramStatus: "PENDING",
      instagramRetryCount: { increment: 1 },
      instagramLastRetryAt: new Date(),
    };
  const where = network === "facebook"
    ? {
      id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL" as const, facebookStatus: "UNKNOWN",
      facebookReviewOutcome: "NOT_FOUND", facebookPostId: null, facebookRetryCount: 0,
      facebookReviewedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    }
    : {
      id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL" as const, instagramStatus: "UNKNOWN",
      instagramReviewOutcome: "NOT_FOUND", instagramPostId: null, instagramRetryCount: 0,
      instagramReviewedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    };

  const updated = await prisma.scheduledPost.updateMany({ where, data: fields });
  if (updated.count !== 1) {
    return { ok: false, message: "El registro cambió. Actualiza el panel y vuelve a revisar Meta." };
  }

  return {
    ok: true,
    message: "Se habilitó un único reintento manual para esta red. Comprueba la imagen HTTPS y confirma antes de publicar.",
  };
}

export async function reopenRejectedInstagramStory(postId: string): Promise<{ ok: boolean; message: string }> {
  const access = await getStudioAccess("content:publish");
  if (!access) return { ok: false, message: "No tienes permiso para publicar." };

  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId, clinicId: access.clinic.id },
    select: {
      status: true,
      archivedAt: true,
      mediaType: true,
      deliveryFormat: true,
      instagramStatus: true,
      instagramError: true,
      instagramPostId: true,
      instagramRetryCount: true,
    },
  });

  const knownRejection = post?.instagramError?.includes("Only photo or video can be accepted as media type.") ?? false;
  if (!post || post.status !== "PENDING_APPROVAL" || post.archivedAt ||
      post.mediaType !== "IMAGE" || post.deliveryFormat !== "STORY" ||
      post.instagramStatus !== "UNKNOWN" || !knownRejection ||
      post.instagramPostId || post.instagramRetryCount !== 0) {
    return { ok: false, message: "Este intento no admite recuperación directa; utiliza la verificación manual." };
  }

  const updated = await prisma.scheduledPost.updateMany({
    where: {
      id: postId,
      clinicId: access.clinic.id,
      status: "PENDING_APPROVAL",
      archivedAt: null,
      mediaType: "IMAGE",
      deliveryFormat: "STORY",
      instagramStatus: "UNKNOWN",
      instagramError: post.instagramError,
      instagramPostId: null,
      instagramRetryCount: 0,
    },
    data: {
      instagramStatus: "PENDING",
      instagramRetryCount: { increment: 1 },
      instagramLastRetryAt: new Date(),
      instagramReviewOutcome: "NOT_FOUND",
      instagramReviewEvidence: "Rechazo explícito de Meta al crear el contenedor: tipo de media no admitido. El operador confirmó que la historia no se publicó.",
      instagramReviewedAt: new Date(),
    },
  });

  return updated.count === 1
    ? { ok: true, message: "La historia quedó lista para un único reintento. Confirma su publicación desde Instagram." }
    : { ok: false, message: "El registro cambió; recarga la página antes de continuar." };
}

export async function confirmMissingAndRetry(postId: string, network: "facebook" | "instagram") {
  const access = await getStudioAccess("content:publish");
  if (!access) return { ok: false, message: "Inicia sesión para publicar." };
  if (network !== "facebook" && network !== "instagram") {
    return { ok: false, message: "Red social no válida." };
  }

  const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
  const status = network === "facebook" ? post?.facebookStatus : post?.instagramStatus;
  const postIdFromMeta = network === "facebook" ? post?.facebookPostId : post?.instagramPostId;
  const retries = network === "facebook" ? post?.facebookRetryCount : post?.instagramRetryCount;

  if (!post || post.status !== "PENDING_APPROVAL" || status !== "UNKNOWN" ||
      postIdFromMeta || retries !== 0) {
    return { ok: false, message: "Este envío no admite recuperación automática. Revisa el historial." };
  }

  const reviewedAt = new Date();
  const evidence = "El operador confirmó expresamente que revisó la red y no encontró la publicación antes de reintentar.";
  const changed = await prisma.scheduledPost.updateMany({
    where: network === "facebook"
      ? { id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL", facebookStatus: "UNKNOWN", facebookPostId: null, facebookRetryCount: 0 }
      : { id: postId, clinicId: access.clinic.id, status: "PENDING_APPROVAL", instagramStatus: "UNKNOWN", instagramPostId: null, instagramRetryCount: 0 },
    data: network === "facebook"
      ? {
        facebookStatus: "PENDING",
        facebookReviewOutcome: "NOT_FOUND",
        facebookReviewEvidence: evidence,
        facebookReviewedAt: reviewedAt,
        facebookRetryCount: { increment: 1 },
        facebookLastRetryAt: reviewedAt,
      }
      : {
        instagramStatus: "PENDING",
        instagramReviewOutcome: "NOT_FOUND",
        instagramReviewEvidence: evidence,
        instagramReviewedAt: reviewedAt,
        instagramRetryCount: { increment: 1 },
        instagramLastRetryAt: reviewedAt,
      },
  });

  if (changed.count !== 1) {
    return { ok: false, message: "La publicación cambió de estado; recarga el panel." };
  }

  return retryPendingNetwork(postId, network);
}

export async function confirmClinicalReview(postId: string) {
  const access = await getStudioAccess("content:review");
  if (!access) {
    return { ok: false, message: "No tienes permiso para revisar contenido." };
  }
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(postId)) {
    return { ok: false, message: "Identificador inválido." };
  }

  const updated = await prisma.scheduledPost.updateMany({
    where: {
      id: postId,
      clinicId: access.clinic.id,
      archivedAt: null,
      status: "PENDING_APPROVAL",
      clinicalVerifiedAt: null,
      facebookStatus: "PENDING",
      instagramStatus: "PENDING",
      tiktokStatus: "PENDING",
    },
    data: { clinicalVerifiedAt: new Date() },
  });
  if (updated.count !== 1) {
    return { ok: false, message: "La propuesta ya fue revisada o inició un envío." };
  }
  return { ok: true, message: "Revisión clínica registrada. La publicación continúa pendiente de envío." };
}

export async function rejectPost(postId: string) {
  const access = await getStudioAccess("content:review");
  if (!access) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const result = await prisma.scheduledPost.updateMany({
      where: {
        id: postId, clinicId: access.clinic.id, archivedAt: null, status: "PENDING_APPROVAL",
        facebookStatus: "PENDING", instagramStatus: "PENDING", tiktokStatus: "PENDING",
        facebookPostId: null, instagramPostId: null, tiktokPublishId: null,
        facebookRetryCount: 0, instagramRetryCount: 0,
      },
      data: { status: "REJECTED", scheduledFor: null },
    });
    return result.count === 1
      ? { ok: true }
      : { ok: false, message: "La publicación ya no está pendiente de aprobación." };
  } catch (error: any) {
    console.error("Error al rechazar publicación:", error);
    return { ok: false, message: "No se pudo actualizar la publicación." };
  }
}

export type PublishNetwork = "facebook" | "instagram" | "tiktok";

export async function publishSelectedNetworks(
  postId: string,
  networks: PublishNetwork[],
  tiktok?: { privacy: string; disableComment: boolean; disableDuet: boolean; disableStitch: boolean },
): Promise<{ ok: boolean; results: { network: PublishNetwork; outcome: "confirmed" | "processing" | "uncertain" | "not_sent"; message: string }[]; message: string }> {
  const access = await getStudioAccess("content:publish");
  if (!access) {
    return { ok: false, results: [], message: "Inicia sesión para publicar." };
  }

  const selected = [...new Set(networks)];
  if (!selected.length || selected.length > 3 ||
      selected.some((network) => !["facebook", "instagram", "tiktok"].includes(network))) {
    return { ok: false, results: [], message: "Selecciona al menos una red social válida." };
  }
  if (selected.includes("tiktok") && !tiktok?.privacy) {
    return { ok: false, results: [], message: "Selecciona la privacidad de TikTok antes de publicar." };
  }

  const post = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id } });
  if (!post || post.archivedAt || !post.mediaUrl || !["PENDING_APPROVAL", "PUBLISHED"].includes(post.status)) {
    return { ok: false, results: [], message: "La propuesta no está disponible para publicar." };
  }

  if (post.deliveryFormat === "STORY" && selected.includes("tiktok")) {
    return { ok: false, results: [], message: "Las historias están disponibles en Facebook e Instagram. TikTok no admite este formato desde este publicador." };
  }

  const results: { network: PublishNetwork; outcome: "confirmed" | "processing" | "uncertain" | "not_sent"; message: string }[] = [];
  for (const network of selected) {
    if (network === "facebook" || network === "instagram") {
      const sent = await retryPendingNetwork(postId, network);
      results.push({
        network,
        outcome: sent.ok ? "confirmed" : sent.notSent ? "not_sent" : "uncertain",
        message: sent.message,
      });
      continue;
    }

    try {
      const approval = await prisma.scheduledPost.updateMany({
        where: { id: postId, clinicId: access.clinic.id, archivedAt: null, clinicalVerifiedAt: null },
        data: { clinicalVerifiedAt: new Date() },
      });
      if (approval.count === 0) {
        const current = await prisma.scheduledPost.findUnique({ where: { id: postId, clinicId: access.clinic.id }, select: { archivedAt: true } });
        if (!current || current.archivedAt) throw new Error("La publicación ya no está disponible.");
      }
      await publishToTikTok(postId, tiktok!.privacy, {
        disableComment: tiktok!.disableComment,
        disableDuet: tiktok!.disableDuet,
        disableStitch: tiktok!.disableStitch,
      });
      results.push({ network, outcome: "processing", message: "TikTok recibió el archivo y continúa procesándolo." });
    } catch (error) {
      results.push({
        network,
        outcome: "uncertain",
        message: error instanceof Error ? error.message : "No se pudo confirmar el envío a TikTok.",
      });
    }
  }

  const confirmed = results.filter((result) => result.outcome === "confirmed").length;
  const processing = results.filter((result) => result.outcome === "processing").length;
  const notSent = results.filter((result) => result.outcome === "not_sent").length;
  const uncertain = results.filter((result) => result.outcome === "uncertain").length;
  const summary = [
    confirmed && `${confirmed} confirmada(s)`,
    processing && `${processing} en procesamiento`,
    notSent && `${notSent} sin enviar`,
    uncertain && `${uncertain} por verificar`,
  ].filter(Boolean).join(" · ");
  return {
    ok: notSent === 0 && uncertain === 0,
    results,
    message: summary + (uncertain ? ". Verifica los envíos inciertos en Meta antes de repetirlos." : ""),
  };
}
