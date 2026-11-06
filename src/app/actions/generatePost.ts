"use server";

import { prisma } from "@/lib/prisma";

interface GeneratePostParams {
  procedure: string;
  imageUrl?: string;
  notes?: string;
}

export async function generateClinicalPost({ procedure, imageUrl, notes }: GeneratePostParams) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error("Falta la API Key de xAI (Grok)");
  }

  // Prompt clínico estructurado para el tono odontológico profesional
  const systemPrompt = `Eres un experto en marketing digital especializado en clínicas dentales y odontología estética. 
Tu objetivo es generar publicaciones atractivas, profesionales, éticas y orientadas a la conversión para Instagram y Facebook.
La publicación debe incluir:
1. Un gancho llamativo relacionado con la salud o estética dental.
2. Una explicación breve y sencilla del procedimiento (${procedure}).
3. Un llamado a la acción (CTA) claro para agendar una cita de valoración.
4. Hashtags estratégicos al final.`;

  const userPrompt = `Genera un post para redes sociales sobre el siguiente procedimiento dental: "${procedure}". 
${notes ? `Notas adicionales del caso clínico: ${notes}` : ""}
${imageUrl ? "Analiza el contexto visual de la foto clínica adjunta para inspirar el texto." : ""}`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const generatedCaption = data.choices?.[0]?.message?.content || "No se pudo generar el contenido.";

    // Opcional: Guardar el resultado en la base de datos como borrador/pendiente de aprobación
    // const post = await prisma.post.create({ ... })

    return {
      success: true,
      caption: generatedCaption,
    };

  } catch (error) {
    console.error("Error al generar contenido con Grok-3:", error);
    return {
      success: false,
      error: "Error al comunicarse con la API de xAI.",
    };
  }
}