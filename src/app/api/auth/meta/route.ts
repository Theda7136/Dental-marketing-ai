import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getStudioAccess } from "@/lib/studioAccess";
import { STUDIO_SESSION_COOKIE } from "@/lib/studioSession";
import { oauthBinding } from "@/lib/socialOAuthState";

export async function GET() {
  const session = await getStudioAccess("connections:manage");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  const sessionToken = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Sesión no disponible." }, { status: 403 });
  const appId = process.env.META_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = process.env.META_REDIRECT_URI || new URL("/api/auth/meta/callback", baseUrl).toString();
  const state = randomBytes(32).toString("hex");

  // Permisos compatibles con las versiones v26.0+ de Meta Graph API
  const scopes = [
    "public_profile",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
  ].join(",");

  const authUrl = `https://www.facebook.com/v26.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scopes}&response_type=code&state=${state}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("meta_oauth_binding", oauthBinding("meta", state, sessionToken, session.clinic.id, session.user.id), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/auth/meta/callback", maxAge: 600,
  });
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/meta/callback",
    maxAge: 600,
  });
  return response;
}