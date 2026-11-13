import { prisma } from "@/lib/prisma";

const API = "https://open.tiktokapis.com";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

function credentials() {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!key || !secret) throw new Error("Configura TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET.");
  return { key, secret };
}

export async function getTikTokAccess() {
  const account = await prisma.account.findFirst({ where: { provider: "tiktok", clinicId: "pilot" } });
  if (!account) throw new Error("Conecta tu cuenta de TikTok en Conexiones.");
  if (!(account.grantedScopes || "").split(",").includes("video.publish")) {
    throw new Error("Reconecta TikTok autorizando el permiso video.publish.");
  }
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 90_000) {
    return { account, token: account.accessToken };
  }
  if (!account.refreshToken) throw new Error("La sesión de TikTok caducó. Reconecta la cuenta.");

  const { key, secret } = credentials();
  const response = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const refreshed = await response.json() as TokenResponse;
  if (!response.ok || !refreshed.access_token || !refreshed.refresh_token) {
    throw new Error("No se pudo renovar la autorización de TikTok. Reconecta la cuenta.");
  }
  await prisma.account.update({
    where: { id: account.id, clinicId: "pilot" },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(Date.now() + Number(refreshed.expires_in || 7200) * 1000),
      ...(refreshed.scope ? { grantedScopes: refreshed.scope } : {}),
    },
  });
  return { account, token: refreshed.access_token };
}

type TikTokResult<T> = { data?: T; error?: { code?: string; message?: string } };

export async function tikTokRequest<T>(endpoint: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const json = await response.json() as TikTokResult<T>;
  if (!response.ok || json.error?.code !== "ok" || !json.data) {
    const code = json.error?.code || `HTTP ${response.status}`;
    throw new Error(`TikTok rechazó la solicitud (${code}). ${json.error?.message || ""}`.trim());
  }
  return json.data;
}

export type CreatorInfo = {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

export async function getTikTokCreator() {
  const { token } = await getTikTokAccess();
  const creator = await tikTokRequest<CreatorInfo>("/v2/post/publish/creator_info/query/", token, {});
  return { creator, token };
}
