import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";
import { ImageServiceError, parsePhotoOptions, overlayOnClinicTemplate, removeClinicalBackground, renderStoryPhoto } from "@/services/imageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Selecciona una foto JPEG, PNG o WebP de máximo 20 MB." }, { status: 400 });
    }

    const deliveryFormat = form.get("deliveryFormat");
    if (!["FEED", "REEL", "STORY"].includes(String(deliveryFormat))) {
      return NextResponse.json({ error: "Selecciona un formato de publicación válido." }, { status: 400 });
    }

    const options = parsePhotoOptions({
      layout: form.get("photoLayout"),
      background: form.get("photoBackground"),
      preset: form.get("photoPreset"),
      zoom: form.get("photoZoom"),
      offsetX: form.get("photoOffsetX"),
      offsetY: form.get("photoOffsetY"),
    });
    const brand = await prisma.brandProfile.findUnique({ where: { id: "default", clinicId: session.clinic.id } });
    const composition = {
      cleanImage: await removeClinicalBackground(new Uint8Array(await file.arrayBuffer())),
      procedureName: String(form.get("procedureName") || ""),
      options,
      brand,
    };
    const rendered = deliveryFormat === "STORY"
      ? await renderStoryPhoto(composition)
      : await overlayOnClinicTemplate(composition);
    return new NextResponse(new Uint8Array(rendered), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, private",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof ImageServiceError ? error.message : "No se pudo preparar la vista previa.";
    return NextResponse.json({ error: message }, { status: error instanceof ImageServiceError ? 400 : 500 });
  }
}
