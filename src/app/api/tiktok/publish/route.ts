import { NextRequest, NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { publishToTikTok, refreshTikTokPostStatus } from "@/lib/tiktokPublisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  let params: { postId?: string; privacy?: string };
  try { params = await request.json(); }
  catch { return NextResponse.json({ error: "Datos de publicación inválidos." }, { status: 400 }); }
  if (!params.postId || !/^[\w-]{8,64}$/.test(params.postId) || !params.privacy) {
    return NextResponse.json({ error: "Selecciona una publicación y su privacidad." }, { status: 400 });
  }
  try {
    const publication = await publishToTikTok(params.postId, params.privacy);
    return NextResponse.json({ ok: true, ...publication });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el envío." }, { status: 409 });
  }
}
export async function GET(request: NextRequest) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !/^[\w-]{8,64}$/.test(postId)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }
  try {
    const status = await refreshTikTokPostStatus(postId);
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo comprobar el envío." }, { status: 409 });
  }
}
