import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { prisma } from "@/lib/prisma";
import { clinicalGuardrails } from "@/config/clinicalGuardrails";
import { renderVideoAd, type AdScene, type VideoAdStyle, type CaptionFont } from "@/services/videoAdRenderer";
import { generateGeminiNarration, GEMINI_VOICES, type GeminiVoice } from "@/services/geminiNarration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_BODY_BYTES = 125 * 1024 * 1024;
const MAX_SCENES = 12;
let renderInProgress = false;

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
    const style = form.get("style");
    if (style !== "premium" && style !== "dinamico" && style !== "educativo") {
      return NextResponse.json({ error: "Elige un estilo audiovisual válido." }, { status: 400 });
    }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_SCENES ||
        form.get("authorized") !== "true") {
      return NextResponse.json({ error: "Confirma la autorización y añade entre 1 y 12 escenas." }, { status: 400 });
    }

    const voice = form.get("voice") ?? "Kore";
    const captionFont = form.get("captionFont") ?? "arial";
    if (typeof voice !== "string" || !GEMINI_VOICES.some(option => option === voice)) {
      return NextResponse.json({ error: "Selecciona una voz válida." }, { status: 400 });
    }
    if (typeof captionFont !== "string" || !["arial", "georgia", "verdana", "trebuchet"].includes(captionFont)) {
      return NextResponse.json({ error: "Selecciona una fuente válida." }, { status: 400 });
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

    const musicFile = form.get("music");
    const musicVolume = Number(form.get("musicVolume") ?? 0.18);
    if (!Number.isFinite(musicVolume) || musicVolume < 0.05 || musicVolume > 0.5) {
      return NextResponse.json({ error: "El volumen musical debe estar entre 5 % y 50 %." }, { status: 400 });
    }
    let music: { bytes: Buffer; extension: "mp3" | "wav" | "m4a"; volume: number } | undefined;
    if (musicFile !== null) {
      if (!(musicFile instanceof File) || musicFile.size < 100 || musicFile.size > 12 * 1024 * 1024) {
        return NextResponse.json({ error: "La pista musical debe tener un tamaño máximo de 12 MB." }, { status: 400 });
      }
      const extension = musicFile.name.split(".").pop()?.toLowerCase();
      if (extension !== "mp3" && extension !== "wav" && extension !== "m4a") {
        return NextResponse.json({ error: "Selecciona una pista MP3, WAV o M4A." }, { status: 400 });
      }
      const bytes = Buffer.from(await musicFile.arrayBuffer());
      if (uploadedBytes + bytes.length > 120 * 1024 * 1024) {
        return NextResponse.json({ error: "El material supera los 120 MB permitidos." }, { status: 413 });
      }
      music = { bytes, extension, volume: musicVolume };
    }

    const narrationEnabled = form.get("narration") === "true";
    const narrationScript = records.map(scene => scene.heading.trim()).filter(Boolean).join(". ");
    if (narrationEnabled && narrationScript.length > 1200) {
      return NextResponse.json({ error: "El guion de voz supera 1200 caracteres." }, { status: 400 });
    }

    const brand = await prisma.brandProfile.findUnique({
      where: { clinicId: access.clinic.id },
      select: { clinicName: true, primaryColor: true, logoDataUrl: true },
    });
    if (renderInProgress) {
      return NextResponse.json({ error: "Ya hay un video procesándose. Intenta nuevamente cuando termine." }, { status: 429 });
    }

    renderInProgress = true;
    let video: Buffer;
    try {
      const narration = narrationEnabled ? await generateGeminiNarration(narrationScript, voice as GeminiVoice) : undefined;
      video = await renderVideoAd(records, brand ?? {
        clinicName: access.clinic.name, primaryColor: "#116D60", logoDataUrl: null,
      }, style as VideoAdStyle, narration, music, captionFont as CaptionFont);
    } finally {
      renderInProgress = false;
    }

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
