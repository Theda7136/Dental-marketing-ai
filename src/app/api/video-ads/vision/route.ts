import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { AIProviderError, describeDentalImage } from "@/services/aiProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await getStudioAccess("content:write");
  if (!access) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    const form = await request.formData();
    if (form.get("consent") !== "true") {
      return NextResponse.json({ error: "Debes autorizar el análisis de imágenes con Gemini." }, { status: 400 });
    }
    const image = form.get("image");
    if (!(image instanceof File) || image.type !== "image/jpeg" || image.size === 0 || image.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Envía una imagen JPEG válida de máximo 2 MB." }, { status: 400 });
    }
    const description = await describeDentalImage(new Uint8Array(await image.arrayBuffer()));
    return NextResponse.json({ description }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error al analizar imagen para Video Ad Studio.", error);
    return NextResponse.json({ error: "No fue posible analizar la imagen." }, { status: 500 });
  }
}
