import { NextRequest, NextResponse } from "next/server";
import type { ClinicRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";
import { hashSessionToken, newSessionToken } from "@/lib/studioCredentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteRoles = new Set<ClinicRole>(["ADMIN", "EDITOR", "REVIEWER"]);

export async function GET() {
  const session = await getStudioAccess("members:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const invitations = await prisma.clinicInvite.findMany({
    where: { clinicId: session.clinic.id },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ invitations }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await getStudioAccess("members:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role as ClinicRole;
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !inviteRoles.has(role) ||
      (session.role !== "OWNER" && role === "ADMIN")) {
    return NextResponse.json({ error: "Correo o rol inválido." }, { status: 400 });
  }

  const existingUser = await prisma.studioUser.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Este correo ya está registrado. Gestiona su membresía existente." }, { status: 409 });
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await prisma.clinicInvite.create({
    data: { clinicId: session.clinic.id, email, role, tokenHash: hashSessionToken(token),
      expiresAt, createdBy: session.user.id },
  });

  const url = new URL("/invitacion", request.nextUrl.origin);
  url.searchParams.set("token", token);

  return NextResponse.json({ invitationUrl: url.toString(), expiresAt }, {
    status: 201, headers: { "Cache-Control": "no-store" },
  });
}
