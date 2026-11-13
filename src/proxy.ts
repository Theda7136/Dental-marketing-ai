import { NextRequest, NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { isValidMediaSignature } from "@/lib/mediaSignature";
import { readStudioSession, STUDIO_SESSION_COOKIE } from "@/lib/studioSession";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" ||
    pathname === "/api/studio/login" ||
    pathname === "/api/auth/meta/callback";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const mediaMatch = /^\/api\/media\/([0-9a-f-]+)$/i.exec(pathname);
  const signedMedia = mediaMatch !== null && isValidMediaSignature(
    mediaMatch[1],
    request.nextUrl.searchParams.get("expires"),
    request.nextUrl.searchParams.get("signature"),
  );

  if (isPublicPath(pathname) || signedMedia) {
    return NextResponse.next();
  }

  if (isClinicAuthorized(request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  const session = await readStudioSession(request.cookies.get(STUDIO_SESSION_COOKIE)?.value);
  if (session?.clinic.id === "pilot" && session.role === "OWNER") {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
        return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
      }
    }

    // During the pilot transition the existing handlers still require Basic Auth.
    // Only a validated owner session for the same pilot clinic gets the internal header.
    const headers = new Headers(request.headers);
    const pilotPassword = process.env.DENTAL_APP_PASSWORD;
    if (!pilotPassword || pilotPassword.length < 16) return unauthorizedResponse(pathname.startsWith("/api/"));
    headers.set("authorization", `Basic ${Buffer.from(`clinica:${pilotPassword}`).toString("base64")}`);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname === "/api/studio/logout") {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return unauthorizedResponse(true);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
