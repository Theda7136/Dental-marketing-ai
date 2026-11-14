import { NextResponse } from "next/server";
import sharp from "sharp";
import { prepareLogo } from "@/services/logoService";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BRAND = {
  clinicName: "Dental Studio",
  primaryColor: "#116D60",
  fontFamily: "SANS",
  logoDataUrl: null as string | null,
};

export async function GET() {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const brand = await prisma.brandProfile.findUnique({ where: { id: "default", clinicId: session.clinic.id } });
  return NextResponse.json({ brand: brand ?? DEFAULT_BRAND }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}

export async function POST(request: Request) {
  const session = await getStudioAccess("brand:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    const form = await request.formData();
    const clinicName = String(form.get("clinicName") ?? "").trim();
    const primaryColor = String(form.get("primaryColor") ?? "").toUpperCase();
    const fontFamily = String(form.get("fontFamily") ?? "");
    if (!clinicName || clinicName.length > 70 || !/^#[0-9A-F]{6}$/.test(primaryColor) ||
        !["SANS", "SERIF", "MODERN"].includes(fontFamily)) {
      return NextResponse.json({ error: "Revisa el nombre, color o tipografía." }, { status: 400 });
    }

    const current = await prisma.brandProfile.findUnique({ where: { id: "default", clinicId: session.clinic.id } });
    const logo = form.get("logo");
    let logoDataUrl = current?.logoDataUrl ?? null;
    if (form.get("removeLogo") === "true") {
      logoDataUrl = null;
    } else if (logo instanceof File && logo.size > 0) {
      if (logo.size > 2_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(logo.type)) {
        return NextResponse.json({ error: "El logotipo debe ser JPG, PNG o WebP de máximo 2 MB." }, { status: 400 });
      }
      const image = sharp(Buffer.from(await logo.arrayBuffer()), {
        failOn: "error",
        limitInputPixels: 8_000_000,
      });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width < 32 || metadata.height < 32) {
        return NextResponse.json({ error: "El logotipo debe tener al menos 32 × 32 px." }, { status: 400 });
      }
      const compressed = await prepareLogo(Buffer.from(await logo.arrayBuffer()));
      if (compressed.length > 400_000) {
        return NextResponse.json({ error: "El logotipo procesado es demasiado grande." }, { status: 400 });
      }
      logoDataUrl = `data:image/png;base64,${compressed.toString("base64")}`;
    }

    const brand = await prisma.brandProfile.upsert({
      where: { id: "default", clinicId: session.clinic.id },
      create: { id: "default", clinicId: session.clinic.id, clinicName, primaryColor, fontFamily, logoDataUrl },
      update: { clinicName, primaryColor, fontFamily, logoDataUrl },
    });
    return NextResponse.json({ brand });
  } catch {
    return NextResponse.json({ error: "No fue posible guardar la identidad de marca." }, { status: 500 });
  }
}
