"use server";

import { prisma } from "@/lib/prisma";
import { publishToMeta } from "@/lib/metaPublish";

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
  try {
    const procedureName = formData.get("procedureName") as string;
    const notes = formData.get("notes") as string;

    if (!procedureName) {
      return { ok: false, message: "El procedimiento es obligatorio." };
    }

    const generatedCaption = await generateCaptionWithGrok(procedureName, notes);

    const newPost = {
      id: Math.random().toString(36).substring(2, 9),
      procedureName,
      generatedCaption: `Guion / Idea: \n\n${generatedCaption}`,
      mediaUrl: "",
      status: "PENDING_APPROVAL" as const,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, post: newPost };
  } catch (error: any) {
    console.error("Error al crear texto:", error);
    return { ok: false, message: error.message || "Error al generar el texto." };
  }
}

export async function approveAndPublishPost(postData: {
  id: string;
  mediaUrl: string;
  generatedCaption: string;
  mediaKind: string;
}) {
  try {
    const result = await publishToMeta(postData);
    return { ok: true, ...result };
  } catch (error: any) {
    console.error("Error al publicar en redes:", error);
    return { ok: false, message: error.message || "Error desconocido al publicar." };
  }
}