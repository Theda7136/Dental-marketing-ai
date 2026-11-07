import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";

export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) {
    return unauthorizedResponse(true);
  }

  try {
    const account = await prisma.account.findFirst({
      where: { provider: "facebook" },
    });

    if (!account?.accessToken || !account.pageId) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      userName: account.name || "Usuario Meta",
      pageName: account.pageName || "Clínica Dental",
      instagramConnected: Boolean(account.instagramId),
    });
  } catch (error) {
    console.error("Error al consultar cuenta social:", error);
    return NextResponse.json({ connected: false }, { status: 500 });
  }
}
