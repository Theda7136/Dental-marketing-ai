import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getStudioAccess("members:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const memberships = await prisma.clinicMembership.findMany({
    where: { clinicId: session.clinic.id },
    include: { user: { select: { id: true, email: true, displayName: true, disabledAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  const members = memberships.map(({ id, role, user }) => ({
    id, role, userId: user.id, email: user.email, displayName: user.displayName,
    disabled: Boolean(user.disabledAt),
  }));
  return NextResponse.json({ members, currentUserId: session.user.id }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
