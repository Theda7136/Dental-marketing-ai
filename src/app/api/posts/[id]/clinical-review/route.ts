import { NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return NextResponse.json({ message: "Publicación no válida." }, { status: 400 });
  }

  let payload: { confirmed?: unknown };
  try {
    payload = await request.json() as { confirmed?: unknown };
  } catch {
    return NextResponse.json({ message: "Solicitud no válida." }, { status: 400 });
  }
  if (payload.confirmed !== true) {
    return NextResponse.json({ message: "Debes confirmar la revisión clínica." }, { status: 400 });
  }

  try {
    const updated = await prisma.scheduledPost.updateMany({
      where: {
        id,
        archivedAt: null,
        status: "PENDING_APPROVAL",
        facebookStatus: "PENDING",
        instagramStatus: "PENDING",
        facebookRetryCount: 0,
        instagramRetryCount: 0,
        facebookPostId: null,
        instagramPostId: null,
        mediaUrl: { not: "" },
      },
      data: { clinicalVerifiedAt: new Date() },
    });
    if (updated.count !== 1) {
      return NextResponse.json({
        message: "El registro no está listo para revisión. Comprueba que no tenga envíos iniciados.",
      }, { status: 409 });
    }
    const post = await prisma.scheduledPost.findUnique({
      where: { id },
      select: { clinicalVerifiedAt: true },
    });
    return NextResponse.json({ ok: true, clinicalVerifiedAt: post?.clinicalVerifiedAt?.toISOString() });
  } catch (error) {
    console.error("No se pudo registrar la revisión clínica:", error);
    return NextResponse.json({ message: "No se pudo guardar la revisión clínica." }, { status: 500 });
  }
}
