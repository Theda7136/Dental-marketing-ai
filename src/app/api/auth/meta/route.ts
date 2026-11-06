import { NextResponse } from "next/server";

export async function GET() {
  const appId = process.env.META_CLIENT_ID;
  const redirectUri = "http://localhost:3000/api/auth/meta/callback";

  // Permisos compatibles con las versiones v19.0+ de Meta Graph API
  const scopes = [
    "public_profile",
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
    "instagram_content_publish",
  ].join(",");

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scopes}&response_type=code`;

  return NextResponse.redirect(authUrl);
}