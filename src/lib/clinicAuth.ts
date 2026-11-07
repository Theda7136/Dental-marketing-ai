import { timingSafeEqual } from "node:crypto";

const BASIC_SCHEME = "Basic ";

export function isClinicAuthorized(authorization: string | null): boolean {
  const expectedPassword = process.env.DENTAL_APP_PASSWORD;
  if (!expectedPassword || expectedPassword.length < 16 || !authorization?.startsWith(BASIC_SCHEME)) {
    return false;
  }

  let credentials: string;
  try {
    credentials = Buffer.from(authorization.slice(BASIC_SCHEME.length), "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = credentials.indexOf(":");
  if (separator < 0 || credentials.slice(0, separator) !== "clinica") {
    return false;
  }

  const suppliedPassword = Buffer.from(credentials.slice(separator + 1));
  const expected = Buffer.from(expectedPassword);
  return suppliedPassword.length === expected.length && timingSafeEqual(suppliedPassword, expected);
}

export function unauthorizedResponse(isApiRequest: boolean): Response {
  return new Response(
    isApiRequest ? JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Autenticación requerida." } }) : "Autenticación requerida.",
    {
      status: 401,
      headers: {
        "Content-Type": isApiRequest ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Dental Marketing Pilot", charset="UTF-8"',
      },
    },
  );
}
