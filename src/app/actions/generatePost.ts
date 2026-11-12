"use server";

import { headers } from "next/headers";
import { isClinicAuthorized } from "@/lib/clinicAuth";
import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { generateDentalVariants } from "@/services/aiProvider";

interface GeneratePostParams {
  procedure: string;
  imageUrl?: string;
  notes?: string;
}

export async function generateClinicalPost({ procedure, notes }: GeneratePostParams) {
  if (!isClinicAuthorized((await headers()).get("authorization"))) {
    throw new Error("Inicia sesión para usar el panel.");
  }

  const selected = procedure.trim();
  if (!clinicalGuardrails.allowedDentalTerms.some((term) => term === selected)) {
    return { success: false, error: "Selecciona un procedimiento odontológico permitido." };
  }

  try {
    const context = notes?.trim().slice(0, 800) || "Sin notas adicionales confirmadas.";
    clinicalGuardrails.validate(context);
    const drafts = await generateDentalVariants(selected, context);
    const caption = [
      drafts.educational.caption,
      drafts.educational.hashtags.join(" "),
      drafts.educational.suggestedCallToAction,
    ].join("\n\n");
    clinicalGuardrails.validate(caption);
    return { success: true, caption };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo generar el contenido.",
    };
  }
}
