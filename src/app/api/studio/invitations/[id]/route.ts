import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getStudioAccess("members:manage");
  if (!actor) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const { id } = await params;
  const invite = await prisma.clinicInvite.findFirst({
    where: { id, clinicId: actor.clinic.id },
    select: { id: true, role: true },
  });
  if (!invite || (actor.role !== "OWNER" && invite.role === "ADMIN")) {
    return NextResponse.json({ error: "Invitación no encontrada." }, { status: 404 });
  }

  await prisma.clinicInvite.updateMany({
    where: { id: invite.id, clinicId: actor.clinic.id, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
