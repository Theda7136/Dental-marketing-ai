import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { resolvePageInstagramAccount } from "@/lib/instagramAccount";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) {
    return unauthorizedResponse(true);
  }

  try {
    const account = await prisma.account.findFirst({ where: { provider: "facebook", clinicId: "pilot" } });
    if (!account?.accessToken || !account.pageId) {
      return NextResponse.json({ connected: false, instagramConnected: false });
    }

    let instagramId = account.instagramId;
    let instagramCheck: "verified" | "unavailable" = "verified";

    try {
      const linkedId = await resolvePageInstagramAccount(account.pageId, account.accessToken);
      instagramId = linkedId;
      if (linkedId !== account.instagramId) {
        await prisma.account.update({
          where: { id: account.id, clinicId: "pilot" },
          data: { instagramId: linkedId },
        });
      }
    } catch (error) {
      instagramCheck = "unavailable";
      console.warn("No se pudo verificar Instagram en Meta Graph API:", error);
    }

    return NextResponse.json({
      connected: true,
      userName: account.name || "Usuario Meta",
      pageName: account.pageName || "Clínica Dental",
      instagramConnected: Boolean(instagramId),
      instagramCheck,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error al consultar cuenta social:", error);
    return NextResponse.json({ connected: false, instagramConnected: false }, { status: 500 });
  }
}
