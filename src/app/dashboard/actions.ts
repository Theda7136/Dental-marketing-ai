"use server";

import { headers } from "next/headers";
import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized } from "@/lib/clinicAuth";
import { publishToMeta } from "@/lib/metaPublish";

async function hasClinicAccess(): Promise<boolean> {
  return isClinicAuthorized((await headers()).get("authorization"));
}

// Función para generar texto con Grok (xAI)
async function generateCaptionWithGrok(procedureName: string, notes: string) {
  const apiKey = process.env.XAI_API_KEY;
  
  if (!apiKey) {
    return `Caso clínico de ${procedureName}. ${notes || "Excelente resultado en clínica."}\n\n#Odontología #SaludDental #${procedureName.replace(/\s+/g, '')}`;
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3",
        messages: [
          {
            role: "system",
            content: "Eres un experto en marketing médico y odontológico. Redacta copys atractivos, profesionales y empáticos para Instagram y Facebook basados en casos clínicos reales, cumpliendo con normativas de salud y añadiendo hashtags relevantes."
          },
          {
            role: "user",
            content: "Procedimiento dental: " + procedureName + ". Notas del caso: " + (notes || "Ninguna nota adicional")
          }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || `Caso clínico de ${procedureName}.`;
  } catch (error) {
    console.error("Error conectando con Grok:", error);
    return `Caso clínico de ${procedureName}. ${notes || ""}\n\n#Odontología #SaludDental`;
  }
}

export async function createMarketingProposal(formData: FormData) {
  if (!(await hasClinicAccess())) {
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
    const generatedCaption = await generateCaptionWithGrok(procedureName, notes);

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
  if (!(await hasClinicAccess())) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const procedureName = formData.get("procedureName") as string;
    const notes = formData.get("notes") as string;

    if (!procedureName) {
      return { ok: false, message: "El procedimiento es obligatorio." };
    }

    if (!clinicalGuardrails.allowedDentalTerms.some((term) => term === procedureName)) {
      return { ok: false, message: "Elige un procedimiento odontológico permitido." };
    }

    clinicalGuardrails.validate(notes);

    const generatedCaption = await generateCaptionWithGrok(procedureName, notes);
    clinicalGuardrails.validate(generatedCaption);

    const post = await prisma.scheduledPost.create({
      data: {
        procedureName,
        mediaType: "IMAGE",
        generatedCaption: `Guion / Idea: \n\n${generatedCaption}`,
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
        facebookReviewedAt: post.facebookReviewedAt?.toISOString() ?? null,
        instagramReviewedAt: post.instagramReviewedAt?.toISOString() ?? null,
        mediaKind: "text" as const,
      },
    };
  } catch (error: any) {
    console.error("Error al crear texto:", error);
    return { ok: false, message: error.message || "Error al generar el texto." };
  }
}

export async function updatePendingCaption(postId: string, caption: string) {
  if (!(await hasClinicAccess())) {
    return { ok: false, message: "Inicia sesión para editar propuestas." };
  }

  const revisedCaption = caption.trim();
  if (!revisedCaption || revisedCaption.length > 2200) {
    return { ok: false, message: "El texto debe tener entre 1 y 2200 caracteres." };
  }

  try {
    clinicalGuardrails.validate(revisedCaption);
    const updated = await prisma.scheduledPost.updateMany({
      where: { id: postId, status: "PENDING_APPROVAL", facebookStatus: "PENDING", instagramStatus: "PENDING" },
      data: { generatedCaption: revisedCaption },
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
  if (!(await hasClinicAccess())) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
    if (!post || post.status !== "PENDING_APPROVAL") {
      return { ok: false, message: "La publicación ya no está pendiente de aprobación." };
    }
    if (!post.mediaUrl) {
      return { ok: false, message: "Las ideas de texto no se pueden publicar como una imagen." };
    }
    const result = await publishToMeta({
      id: post.id,
      mediaUrl: post.mediaUrl,
      generatedCaption: post.generatedCaption,
      mediaKind: post.mediaType === "VIDEO" ? "video" : "image",
    });
    const approvedAt = new Date();
    await prisma.scheduledPost.update({
      where: { id: post.id },
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
): Promise<{ ok: boolean; message: string }> {
  if (!(await hasClinicAccess())) {
    return { ok: false, message: "Inicia sesión para publicar." };
  }

  try {
    const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
    if (!post || !["PENDING_APPROVAL", "PUBLISHED"].includes(post.status)) {
      return { ok: false, message: "La propuesta ya no admite publicaciones." };
    }
    if (!post.mediaUrl) {
      return { ok: false, message: "Las ideas de texto no se pueden enviar como imágenes." };
    }

    const networkStatus = network === "facebook" ? post.facebookStatus : post.instagramStatus;
    if (networkStatus !== "PENDING") {
      return {
        ok: false,
        message: "Esta red ya fue utilizada o tiene un resultado incierto. Verifica el estado en Meta antes de continuar.",
      };
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
        where: { id: post.id },
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
    return {
      ok: false,
      message: "No se confirmó la publicación. Revisa la cuenta de Meta antes de intentar nuevamente.",
    };
  }
}

export async function recordDeliveryReview(
  postId: string,
  network: "facebook" | "instagram",
  outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN",
  evidence: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await hasClinicAccess())) {
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
    const where = { id: postId, [statusField]: { in: ["UNKNOWN", "IN_PROGRESS"] } };
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

export async function rejectPost(postId: string) {
  if (!(await hasClinicAccess())) {
    return { ok: false, message: "Inicia sesión para usar el panel." };
  }

  try {
    const result = await prisma.scheduledPost.updateMany({
      where: { id: postId, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED" },
    });
    return result.count === 1
      ? { ok: true }
      : { ok: false, message: "La publicación ya no está pendiente de aprobación." };
  } catch (error: any) {
    console.error("Error al rechazar publicación:", error);
    return { ok: false, message: "No se pudo actualizar la publicación." };
  }
}
