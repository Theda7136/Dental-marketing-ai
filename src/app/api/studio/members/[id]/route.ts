import { NextRequest, NextResponse } from "next/server";
import type { ClinicRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";

async function targetMember(sessionClinic: string, id: string) {
  return prisma.clinicMembership.findFirst({
    where: { id, clinicId: sessionClinic },
    select: { id: true, userId: true, role: true },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getStudioAccess("members:manage");
  if (!actor) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const { id } = await params;
  const member = await targetMember(actor.clinic.id, id);
  if (!member || member.role === "OWNER" || member.userId === actor.user.id ||
      (actor.role !== "OWNER" && member.role === "ADMIN")) {
    return NextResponse.json({ error: "No puedes modificar esta membresía." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const role = body?.role as ClinicRole;
  if (!["ADMIN", "EDITOR", "REVIEWER"].includes(role) ||
      (actor.role !== "OWNER" && role === "ADMIN")) {
    return NextResponse.json({ error: "Rol no permitido." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicMembership.update({ where: { id: member.id }, data: { role } });
    await tx.loginSession.updateMany({
      where: { clinicId: actor.clinic.id, userId: member.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getStudioAccess("members:manage");
  if (!actor) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const { id } = await params;
  const member = await targetMember(actor.clinic.id, id);
  if (!member || member.role === "OWNER" || member.userId === actor.user.id ||
      (actor.role !== "OWNER" && member.role === "ADMIN")) {
    return NextResponse.json({ error: "No puedes retirar esta membresía." }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicMembership.delete({ where: { id: member.id } });
    await tx.loginSession.updateMany({
      where: { clinicId: actor.clinic.id, userId: member.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  return NextResponse.json({ ok: true });
}
