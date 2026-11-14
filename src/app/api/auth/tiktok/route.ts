import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getStudioAccess } from "@/lib/studioAccess";
import { STUDIO_SESSION_COOKIE } from "@/lib/studioSession";
import { oauthBinding } from "@/lib/socialOAuthState";

export async function GET(request: NextRequest) {
  const session = await getStudioAccess("connections:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  const sessionToken = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Sesión no disponible." }, { status: 403 });
  const key = process.env.TIKTOK_CLIENT_KEY?.trim();
  const redirect = process.env.TIKTOK_REDIRECT_URI?.trim();
  if (!key || !redirect || !redirect.startsWith("https://")) {
    return NextResponse.json({ message: "Configura TIKTOK_CLIENT_KEY y TIKTOK_REDIRECT_URI (HTTPS)." }, { status: 503 });
  }
  const state = randomBytes(32).toString("hex");
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", key);
  url.searchParams.set("scope", "user.info.basic,video.publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  const response = NextResponse.redirect(url);
  response.cookies.set("tiktok_oauth_binding", oauthBinding("tiktok", state, sessionToken, session.clinic.id, session.user.id), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/tiktok/callback", maxAge: 600,
  });
  response.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/tiktok/callback", maxAge: 600,
  });
  return response;
}
