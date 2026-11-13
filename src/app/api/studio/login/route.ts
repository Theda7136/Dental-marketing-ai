import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createStudioSession, STUDIO_SESSION_COOKIE } from "@/lib/studioSession";
import { verifyStudioPassword } from "@/lib/studioCredentials";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "Formato no permitido." }, { status: 415 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !password || password.length > 256) {
    return NextResponse.json({ error: "Credenciales incorrectas." }, { status: 401 });
  }

  // Cada cuenta debe pertenecer a la clínica piloto; no se habilitan otras clínicas aún.
  const user = await prisma.studioUser.findUnique({
    where: { email },
    include: { memberships: { where: { clinicId: "pilot" }, select: { clinicId: true } } },
  });
  if (!user || user.disabledAt || user.memberships.length !== 1 || !verifyStudioPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Credenciales incorrectas." }, { status: 401 });
  }

  const session = await createStudioSession(user.id, "pilot");
  if (!session) {
    return NextResponse.json({ error: "No fue posible iniciar sesión." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(STUDIO_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
