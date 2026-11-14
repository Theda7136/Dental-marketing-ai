import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { prisma } from "@/lib/prisma";
import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { renderVideoAd, type AdScene } from "@/services/videoAdRenderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_BODY_BYTES = 125 * 1024 * 1024;
const MAX_SCENES = 12;

export async function POST(request: Request) {
  const access = await getStudioAccess("content:write");
  if (!access) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Los archivos enviados superan el tamaño permitido." }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const manifestText = form.get("manifest");
    if (typeof manifestText !== "string" || manifestText.length > 12_000) {
      return NextResponse.json({ error: "El guion es inválido." }, { status: 400 });
    }

    const parsed: unknown = JSON.parse(manifestText);
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_SCENES ||
        form.get("authorized") !== "true") {
      return NextResponse.json({ error: "Confirma la autorización y añade entre 1 y 12 escenas." }, { status: 400 });
    }

    const records: AdScene[] = [];
    let uploadedBytes = 0;
    for (const [index, record] of parsed.entries()) {
      if (!record || typeof record !== "object") throw new Error("El guion es inválido.");
      const scene = record as { seconds?: unknown; heading?: unknown; kind?: unknown };
      const file = form.get(`file-${index}`);
      if (!(file instanceof File) || file.size === 0 || file.size > 80 * 1024 * 1024 ||
          typeof scene.heading !== "string" || typeof scene.seconds !== "number" ||
          (scene.kind !== "image" && scene.kind !== "video")) {
        return NextResponse.json({ error: "Revisa los archivos y las escenas del anuncio." }, { status: 400 });
      }
      uploadedBytes += file.size;
      if (uploadedBytes > 120 * 1024 * 1024) {
        return NextResponse.json({ error: "El material supera los 120 MB permitidos." }, { status: 413 });
      }
      clinicalGuardrails.validate(scene.heading);
      records.push({
        filename: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        kind: scene.kind,
        heading: scene.heading,
        seconds: scene.seconds,
      });
    }

    const brand = await prisma.brandProfile.findUnique({
      where: { clinicId: access.clinic.id },
      select: { clinicName: true, primaryColor: true, logoDataUrl: true },
    });
    const video = await renderVideoAd(records, brand ?? {
      clinicName: access.clinic.name, primaryColor: "#116D60", logoDataUrl: null,
    });

    return new NextResponse(new Uint8Array(video), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="video-publicitario.mp4"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo renderizar el anuncio.";
    if (error instanceof SyntaxError) return NextResponse.json({ error: "El guion no es válido." }, { status: 400 });
    if (message.includes("FFmpeg") || message.includes("procesamiento") || message.includes("render")) {
      console.error("Video Ad Studio: falló el renderizado.", error);
      return NextResponse.json({ error: "No se pudo producir el MP4. Revisa la duración y el formato de los clips." }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
