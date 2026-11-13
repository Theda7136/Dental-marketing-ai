import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSessionToken, hashStudioPassword } from "@/lib/studioCredentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!validToken(token)) return NextResponse.json({ error: "Invitación inválida." }, { status: 404 });

  const invitation = await prisma.clinicInvite.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, clinicId: true },
  });

  if (!invitation || invitation.clinicId !== "pilot" || invitation.acceptedAt ||
      invitation.revokedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Esta invitación ya no está disponible." }, { status: 404 });
  }

  return NextResponse.json({ email: invitation.email, role: invitation.role }, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!validToken(token) || displayName.length < 2 || displayName.length > 80 ||
      password.length < 16 || password.length > 256) {
    return NextResponse.json({ error: "Revisa el nombre y utiliza una contraseña de mínimo 16 caracteres." }, { status: 400 });
  }

  const tokenHash = hashSessionToken(token);
  const invitation = await prisma.clinicInvite.findUnique({ where: { tokenHash } });
  if (!invitation || invitation.clinicId !== "pilot" || invitation.acceptedAt ||
      invitation.revokedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ error: "La invitación expiró o ya fue utilizada." }, { status: 410 });
  }

  const passwordHash = hashStudioPassword(password);
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.clinicInvite.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("INVITE_ALREADY_USED");

      const user = await tx.studioUser.create({
        data: { email: invitation.email, displayName, passwordHash },
      });
      await tx.clinicMembership.create({
        data: { clinicId: invitation.clinicId, userId: user.id, role: invitation.role },
      });
    });
  } catch {
    return NextResponse.json({ error: "No se pudo aceptar la invitación. Comprueba si el usuario ya existe." }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
