import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";

export const runtime = "nodejs";

const defaults = {
  clinicName: "Dental Studio",
  primaryColor: "#147c72",
  backgroundColor: "#0a1817",
  fontFamily: "sans",
  logoDataUrl: null as string | null,
};
const fonts = new Set(["sans", "serif", "modern"]);

function cleanBrand(payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Configuración inválida.");
  const values = payload as Record<string, unknown>;
  const clinicName = typeof values.clinicName === "string" ? values.clinicName.trim() : "";
  if (!clinicName || clinicName.length > 80) throw new Error("El nombre debe tener entre 1 y 80 caracteres.");
  for (const name of ["primaryColor", "backgroundColor"]) {
    if (typeof values[name] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(values[name])) {
      throw new Error("Los colores deben ser códigos hexadecimales válidos.");
    }
  }
  if (!fonts.has(String(values.fontFamily))) throw new Error("Selecciona una tipografía válida.");
  const logo = values.logoDataUrl;
  if (logo !== null && logo !== undefined && (typeof logo !== "string" || logo.length > 350000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))) {
    throw new Error("El logotipo debe ser PNG, JPG o WebP y pesar menos de 250 KB.");
  }
  return {
    clinicName,
    primaryColor: values.primaryColor as string,
    backgroundColor: values.backgroundColor as string,
    fontFamily: values.fontFamily as string,
    logoDataUrl: (logo || null) as string | null,
  };
}

export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  const brand = await prisma.clinicBrand.findUnique({ where: { id: "default" } });
  return NextResponse.json({ brand: brand ?? defaults });
}

export async function PUT(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  let brandInput;
  try {
    brandInput = cleanBrand(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Datos inválidos." }, { status: 400 });
  }
  const brand = await prisma.clinicBrand.upsert({
    where: { id: "default" },
    create: { id: "default", ...brandInput },
    update: brandInput,
  });
  return NextResponse.json({ brand });
}
