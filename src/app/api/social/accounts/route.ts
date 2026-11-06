import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const account = await prisma.account.findFirst({
      where: { provider: "facebook" },
    });

    if (!account) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      userName: account.name || "Usuario Meta",
      pageName: account.pageName || "Clínica Dental",
    });
  } catch (error) {
    console.error("Error al consultar cuenta social:", error);
    return NextResponse.json({ connected: false }, { status: 500 });
  }
}