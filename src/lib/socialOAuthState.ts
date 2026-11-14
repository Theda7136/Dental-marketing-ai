import { createHmac, timingSafeEqual } from "node:crypto";

export type SocialProvider = "meta" | "tiktok";

export function oauthBinding(
  provider: SocialProvider,
  state: string,
  sessionToken: string,
  clinicId: string,
  userId: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(state) || !sessionToken || !clinicId || !userId) {
    throw new Error("Contexto OAuth incompleto.");
  }

  return createHmac("sha256", sessionToken)
    .update(`${provider}:${state}:${clinicId}:${userId}`)
    .digest("hex");
}

export function isValidOAuthCallback(
  provider: SocialProvider,
  receivedState: string,
  storedState: string,
  storedBinding: string,
  sessionToken: string,
  clinicId: string,
  userId: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(receivedState) ||
      !/^[a-f0-9]{64}$/.test(storedState) ||
      !/^[a-f0-9]{64}$/.test(storedBinding)) {
    return false;
  }
  if (!timingSafeEqual(Buffer.from(receivedState, "hex"), Buffer.from(storedState, "hex"))) {
    return false;
  }

  try {
    const expected = oauthBinding(provider, storedState, sessionToken, clinicId, userId);
    return timingSafeEqual(Buffer.from(storedBinding, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
