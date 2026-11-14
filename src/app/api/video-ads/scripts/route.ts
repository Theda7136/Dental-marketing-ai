import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { AIProviderError, generateVideoAdDrafts } from "@/services/aiProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const access = await getStudioAccess("content:write");
  if (!access) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    if (Number(request.headers.get("content-length") ?? 0) > 8_000) {
      return NextResponse.json({ error: "La solicitud supera el tamaño permitido." }, { status: 413 });
    }
    const submitted: unknown = await request.json();
    if (!submitted || typeof submitted !== "object") {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    }
    const form = submitted as Record<string, unknown>;
    if (typeof form.procedure !== "string" || form.procedure.length > 90 ||
        typeof form.goal !== "string" || !["whatsapp", "confianza", "educacion"].includes(form.goal) ||
        typeof form.duration !== "number" || typeof form.sceneCount !== "number" ||
        typeof form.clinicContext !== "string" || form.clinicContext.length > 600) {
      return NextResponse.json({ error: "Revisa el procedimiento, objetivo, duración y notas." }, { status: 400 });
    }
    if (!["Diseño de sonrisa", "Implantes dentales", "Ortodoncia", "Blanqueamiento", "Rehabilitación oral", "Presentación de la clínica"].includes(form.procedure)) {
      return NextResponse.json({ error: "El procedimiento no está permitido." }, { status: 400 });
    }

    const variants = await generateVideoAdDrafts({
      procedure: form.procedure,
      goal: form.goal,
      duration: form.duration,
      sceneCount: form.sceneCount,
      clinicContext: form.clinicContext,
    });
    return NextResponse.json({ variants }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "La solicitud debe ser JSON válido." }, { status: 400 });
    }
    console.error("No se pudieron generar guiones de Video Ad Studio.", error);
    return NextResponse.json({ error: "No fue posible generar los guiones. Intenta de nuevo." }, { status: 500 });
  }
}
