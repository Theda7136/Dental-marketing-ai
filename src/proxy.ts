import { NextRequest, NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { isValidMediaSignature } from "@/lib/mediaSignature";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/auth/meta/callback"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const mediaMatch = /^\/api\/media\/([0-9a-f-]+)$/i.exec(pathname);
  const signedMedia = mediaMatch !== null && isValidMediaSignature(
    mediaMatch[1],
    request.nextUrl.searchParams.get("expires"),
    request.nextUrl.searchParams.get("signature"),
  );

  if (isPublicPath(pathname) || signedMedia || isClinicAuthorized(request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  return unauthorizedResponse(pathname.startsWith("/api/"));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
