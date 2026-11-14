export function productionChecks(env = process.env) {
  const errors = [];
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  let origin;

  try {
    if (!appUrl) throw new Error("missing");
    origin = new URL(appUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash ||
        ["localhost", "127.0.0.1", "0.0.0.0"].includes(origin.hostname)) {
      throw new Error("invalid");
    }
  } catch {
    errors.push("NEXT_PUBLIC_APP_URL debe ser un origen HTTPS público, sin ruta ni credenciales.");
  }

  for (const [key, minimum] of [["DENTAL_APP_PASSWORD", 16], ["DENTAL_MEDIA_SIGNING_SECRET", 32]]) {
    if (!env[key] || env[key].length < minimum) errors.push(`${key} debe tener al menos ${minimum} caracteres.`);
  }

  if (!env.GEMINI_API_KEY?.trim()) errors.push("Falta GEMINI_API_KEY.");

  const storage = ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  if (storage.some((key) => !env[key]?.trim())) {
    errors.push("Producción requiere almacenamiento S3/R2 persistente (bucket, access key y secret key).");
  }
  if (env.AWS_S3_ENDPOINT) {
    try {
      if (new URL(env.AWS_S3_ENDPOINT).protocol !== "https:") throw new Error("invalid");
    } catch {
      errors.push("AWS_S3_ENDPOINT debe ser una URL HTTPS válida.");
    }
  }

  if (env.META_CLIENT_ID || env.META_CLIENT_SECRET || env.META_REDIRECT_URI) {
    if (!env.META_CLIENT_ID || !env.META_CLIENT_SECRET) errors.push("Completa META_CLIENT_ID y META_CLIENT_SECRET.");
    if (!env.META_REDIRECT_URI || !origin ||
        env.META_REDIRECT_URI !== new URL("/api/auth/meta/callback", origin).toString()) {
      errors.push("META_REDIRECT_URI debe coincidir con /api/auth/meta/callback bajo NEXT_PUBLIC_APP_URL.");
    }
  }

  if (env.TIKTOK_CLIENT_KEY || env.TIKTOK_CLIENT_SECRET) {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) errors.push("Completa TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET.");
    if (!env.TIKTOK_REDIRECT_URI || !origin ||
        env.TIKTOK_REDIRECT_URI !== new URL("/api/auth/tiktok/callback", origin).toString()) {
      errors.push("TIKTOK_REDIRECT_URI debe coincidir con /api/auth/tiktok/callback bajo NEXT_PUBLIC_APP_URL.");
    }
  }

  return errors;
}
