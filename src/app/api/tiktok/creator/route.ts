import { NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { getTikTokCreator } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  try {
    const { creator } = await getTikTokCreator();
    return NextResponse.json({
      username: creator.creator_username,
      nickname: creator.creator_nickname,
      privacyOptions: creator.privacy_level_options,
      commentsDisabled: creator.comment_disabled,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TikTok no disponible." }, { status: 503 });
  }
}
