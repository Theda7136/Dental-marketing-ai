import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { getTikTokCreator } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getStudioAccess("connections:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  try {
    const { creator } = await getTikTokCreator(session.clinic.id);
    return NextResponse.json({
      username: creator.creator_username,
      nickname: creator.creator_nickname,
      privacyOptions: creator.privacy_level_options,
      commentsDisabled: creator.comment_disabled,
      duetDisabled: creator.duet_disabled,
      stitchDisabled: creator.stitch_disabled,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TikTok no disponible." }, { status: 503 });
  }
}
