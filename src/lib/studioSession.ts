import { prisma } from "@/lib/prisma";
import { hashSessionToken, newSessionToken } from "@/lib/studioCredentials";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const STUDIO_SESSION_COOKIE = "dental_studio_session";

export async function createStudioSession(userId: string, clinicId: string) {
  const membership = await prisma.clinicMembership.findUnique({
    where: { clinicId_userId: { clinicId, userId } },
    include: { user: { select: { disabledAt: true } }, clinic: { select: { status: true } } },
  });

  if (!membership || membership.user.disabledAt || membership.clinic.status !== "ACTIVE") {
    return null;
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  await prisma.loginSession.create({
    data: { userId, clinicId, tokenHash: hashSessionToken(token), expiresAt },
  });

  return { token, expiresAt, role: membership.role };
}

export async function readStudioSession(token: string | undefined) {
  if (!token || token.length > 256) return null;

  const session = await prisma.loginSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: { select: { id: true, email: true, displayName: true, disabledAt: true } },
      clinic: { select: { id: true, name: true, status: true } },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() ||
      session.user.disabledAt || session.clinic.status !== "ACTIVE") return null;

  const membership = await prisma.clinicMembership.findUnique({
    where: { clinicId_userId: { clinicId: session.clinicId, userId: session.userId } },
    select: { role: true },
  });

  if (!membership) return null;

  return { user: session.user, clinic: session.clinic, role: membership.role };
}

export async function revokeStudioSession(token: string | undefined) {
  if (!token || token.length > 256) return;

  await prisma.loginSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
