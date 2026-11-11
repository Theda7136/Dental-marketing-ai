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
      where: { id: postId, status: "PENDING_APPROVAL" },
      data: { generatedCaption: revisedCaption },
    });

    return updated.count === 1
      ? { ok: true, caption: revisedCaption }
      : { ok: false, message: "Esta propuesta ya no está pendiente de aprobación." };
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
