import { NextRequest, NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { publishToTikTok, refreshTikTokPostStatus } from "@/lib/tiktokPublisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getStudioAccess("content:publish");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  let params: { postId?: string; privacy?: string; disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean };
  try { params = await request.json(); }
  catch { return NextResponse.json({ error: "Datos de publicación inválidos." }, { status: 400 }); }
  if (!params.postId || !/^[\w-]{8,64}$/.test(params.postId) || !params.privacy) {
    return NextResponse.json({ error: "Selecciona una publicación y su privacidad." }, { status: 400 });
  }
  try {
    const publication = await publishToTikTok(params.postId, session.clinic.id, params.privacy, {
      disableComment: params.disableComment === true,
      disableDuet: params.disableDuet === true,
      disableStitch: params.disableStitch === true,
    });
    return NextResponse.json({ ok: true, ...publication });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el envío." }, { status: 409 });
  }
}
export async function GET(request: NextRequest) {
  const session = await getStudioAccess("content:publish");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !/^[\w-]{8,64}$/.test(postId)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }
  try {
    const status = await refreshTikTokPostStatus(postId, session.clinic.id);
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo comprobar el envío." }, { status: 409 });
  }
}
