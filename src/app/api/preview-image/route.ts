import { NextResponse } from "next/server";
import sharp from "sharp";
import { prepareLogo } from "@/services/logoService";
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
    let brand = await prisma.brandProfile.findUnique({ where: { id: "default", clinicId: session.clinic.id } });
    if (form.get("brandPreview") === "true") {
      const manager = await getStudioAccess("brand:manage");
      if (!manager) return NextResponse.json({ error: "No tienes permiso para modificar la marca." }, { status: 403 });

      const clinicName = String(form.get("clinicName") ?? "").trim();
      const primaryColor = String(form.get("primaryColor") ?? "").toUpperCase();
      const fontFamily = String(form.get("fontFamily") ?? "");
      if (!clinicName || clinicName.length > 70 || !/^#[0-9A-F]{6}$/.test(primaryColor) ||
        !["SANS", "SERIF", "MODERN"].includes(fontFamily)) {
        return NextResponse.json({ error: "Revisa el nombre, color o tipografía." }, { status: 400 });
      }

      let logoDataUrl = form.get("removeLogo") === "true" ? null : brand?.logoDataUrl ?? null;
      const logo = form.get("logo");
      if (form.get("removeLogo") !== "true" && logo instanceof File && logo.size > 0) {
        if (logo.size > 2_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(logo.type)) {
          return NextResponse.json({ error: "El logotipo debe ser PNG, JPG o WebP de máximo 2 MB." }, { status: 400 });
        }
        const rawLogo = Buffer.from(await logo.arrayBuffer());
        const metadata = await sharp(rawLogo, { failOn: "error", limitInputPixels: 8_000_000 }).metadata();
        if (!metadata.width || !metadata.height || metadata.width < 32 || metadata.height < 32) {
          return NextResponse.json({ error: "El logotipo debe tener al menos 32 × 32 px." }, { status: 400 });
        }
        const compressed = await prepareLogo(rawLogo);
        if (compressed.length > 400_000) {
          return NextResponse.json({ error: "El logotipo es demasiado grande." }, { status: 400 });
        }
        logoDataUrl = `data:image/png;base64,${compressed.toString("base64")}`;
      }
      brand = { id: "default", clinicId: manager.clinic.id, clinicName, primaryColor, fontFamily, logoDataUrl, updatedAt: new Date() };
    }
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
