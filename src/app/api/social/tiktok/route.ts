import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  try {
    const account = await prisma.account.findFirst({
      where: { provider: "tiktok", clinicId: "pilot" },
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
