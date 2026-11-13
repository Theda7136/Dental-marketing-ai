import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TikTokToken = {
  open_id?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const supplied = url.searchParams.get("state") || "";
  const stored = request.cookies.get("tiktok_oauth_state")?.value || "";
  const valid = supplied.length === 64 && supplied.length === stored.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(stored));
  const redirect = (status: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/conexiones?tiktok=${status}`, request.url));
    response.cookies.set("tiktok_oauth_state", "", { path: "/api/auth/tiktok/callback", maxAge: 0 });
    return response;
  };
  if (!valid) return redirect("invalid_state");
  const code = url.searchParams.get("code");
  if (!code) return redirect("denied");
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!key || !secret || !redirectUri) return redirect("config_missing");

  try {
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: key, client_secret: secret, code,
        grant_type: "authorization_code", redirect_uri: redirectUri,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const tokens = await tokenResponse.json() as TikTokToken;
    if (!tokenResponse.ok || !tokens.open_id || !tokens.access_token || !tokens.refresh_token) {
      return redirect("exchange_failed");
    }
    const scopes = tokens.scope || "";
    await prisma.account.upsert({
      where: { provider_providerAccountId: { provider: "tiktok", providerAccountId: tokens.open_id } },
      update: {
        clinicId: "pilot",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 7200) * 1000),
        grantedScopes: scopes,
      },
      create: {
        clinicId: "pilot",
        provider: "tiktok",
        providerAccountId: tokens.open_id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 7200) * 1000),
        grantedScopes: scopes,
      },
    });
    await prisma.account.deleteMany({
      where: { provider: "tiktok", clinicId: "pilot", providerAccountId: { not: tokens.open_id } },
    });
    return redirect(scopes.split(",").includes("video.publish") ? "connected" : "scope_missing");
  } catch (error) {
    console.error("TikTok OAuth failed:", error);
    return redirect("connection_failed");
  }
}
