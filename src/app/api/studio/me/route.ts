import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Sin autorización." }, { status: 401 });

  return NextResponse.json({
    user: { id: session.user.id, email: session.user.email, displayName: session.user.displayName },
    clinic: { id: session.clinic.id, name: session.clinic.name },
    role: session.role,
  }, { headers: { "Cache-Control": "no-store, private" } });
}
