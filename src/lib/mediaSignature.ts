import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_LIFETIME_SECONDS = 12 * 60 * 60;
function secret(): string {
  const value = process.env.DENTAL_MEDIA_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error("Configura DENTAL_MEDIA_SIGNING_SECRET con al menos 32 caracteres aleatorios.");
  return value;
}
function signature(id: string, expires: string): string {
  return createHmac("sha256", secret()).update(`${id}:${expires}`).digest("hex");
}
export function isValidMediaSignature(id: string, expires: string | null, supplied: string | null): boolean {
  if (!expires || !supplied || !/^\d{10}$/.test(expires) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expiry = Number(expires);
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now || expiry > now + MAX_LIFETIME_SECONDS) return false;
  const expected = Buffer.from(signature(id, expires), "hex");
  const actual = Buffer.from(supplied, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createSignedMediaUrl(id: string, appBaseUrl: string): string {
  const expires = String(Math.floor(Date.now() / 1000) + MAX_LIFETIME_SECONDS);
  const url = new URL(`/api/media/${id}`, appBaseUrl);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL debe usar HTTPS para publicar en Meta.");
  url.searchParams.set("expires", expires);
  url.searchParams.set("signature", signature(id, expires));
  return url.toString();
}
