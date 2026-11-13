import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getStudioAccess("connections:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  try {
    const account = await prisma.account.findFirst({
      where: { provider: "tiktok", clinicId: session.clinic.id },
      select: { name: true, grantedScopes: true, refreshToken: true },
    });
    return NextResponse.json({
      connected: Boolean(account?.refreshToken && (account.grantedScopes || "").split(",").includes("video.publish")),
      userName: account?.name || null,
    });
  } catch {
    return NextResponse.json({ connected: false }, { status: 503 });
  }
}
