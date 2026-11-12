import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { ImageServiceError, parsePhotoOptions, overlayOnClinicTemplate } from "@/services/imageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) {
    return unauthorizedResponse(true);
  }

  try {
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Selecciona una foto JPEG, PNG o WebP de máximo 20 MB." }, { status: 400 });
    }

    const options = parsePhotoOptions({
      layout: form.get("photoLayout"),
      background: form.get("photoBackground"),
      preset: form.get("photoPreset"),
      zoom: form.get("photoZoom"),
      offsetX: form.get("photoOffsetX"),
      offsetY: form.get("photoOffsetY"),
    });
    const brand = await prisma.brandProfile.findUnique({ where: { id: "default" } });
    const preview = await overlayOnClinicTemplate({ cleanImage: new Uint8Array(await file.arrayBuffer()), procedureName: String(form.get("procedureName") || ""), options, brand });
    return new NextResponse(Buffer.from(preview), {
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
