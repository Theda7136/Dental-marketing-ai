import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";
import { resolvePageInstagramAccount } from "@/lib/instagramAccount";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getStudioAccess("connections:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    const account = await prisma.account.findFirst({ where: { provider: "facebook", clinicId: session.clinic.id } });
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
          where: { id: account.id, clinicId: session.clinic.id },
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
