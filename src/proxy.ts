import { NextRequest, NextResponse } from "next/server";
import { unauthorizedResponse } from "@/lib/clinicAuth";
import { canPerform, type ClinicPermission } from "@/lib/clinicPermissions";
import { isValidMediaSignature } from "@/lib/mediaSignature";
import { readStudioSession, STUDIO_SESSION_COOKIE } from "@/lib/studioSession";

function permissionFor(pathname: string, method: string): ClinicPermission | null {
  if (pathname === "/dashboard/equipo" || pathname.startsWith("/api/studio/members") || pathname.startsWith("/api/studio/invitations")) return "members:manage";
  if (pathname === "/api/studio/me" || pathname === "/dashboard" || pathname === "/dashboard/pendientes" ||
      pathname === "/dashboard/historial" || pathname === "/dashboard/calendario" ||
      pathname === "/dashboard/rendimiento" || pathname === "/") return "content:read";
  if (pathname === "/dashboard/crear" || pathname === "/api/create-post" || pathname === "/api/preview-image") return "content:write";
  if (pathname === "/dashboard/conexiones" || pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/social/") || pathname === "/api/tiktok/creator") return "connections:manage";
  if (pathname === "/api/brand") return method === "GET" ? "content:read" : "brand:manage";
  if (pathname === "/api/tiktok/publish") return "content:publish";
  if (pathname === "/api/posts" || pathname === "/api/performance/instagram" ||
      pathname === "/api/performance/facebook" || pathname.startsWith("/api/media/")) return "content:read";
  if (pathname.startsWith("/api/posts/")) {
    if (pathname.endsWith("/schedule")) return "content:write";
    return "content:write";
  }
  return null;
}

function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname === "/api/studio/login" ||
    pathname === "/invitacion" || pathname === "/api/studio/invitations/accept";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const mediaMatch = /^\/api\/media\/([0-9a-f-]+)$/i.exec(pathname);
  const signedMedia = mediaMatch !== null && isValidMediaSignature(
    mediaMatch[1],
    request.nextUrl.searchParams.get("expires"),
    request.nextUrl.searchParams.get("signature"),
  );

  if (signedMedia) return NextResponse.next();
  if (isPublicPath(pathname)) {
    if (pathname === "/api/studio/invitations/accept" && request.method === "POST" &&
        request.headers.get("origin") !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }
    return NextResponse.next();
  }

  const session = await readStudioSession(request.cookies.get(STUDIO_SESSION_COOKIE)?.value);
  if (!session || session.clinic.id !== "pilot") {
    if (!pathname.startsWith("/api/")) return NextResponse.redirect(new URL("/login", request.url));
    return unauthorizedResponse(true);
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }
  }

  if (pathname === "/api/studio/logout") return NextResponse.next();

  const permission = permissionFor(pathname, request.method);
  if (!permission || !canPerform(session.role, permission)) {
    if (!pathname.startsWith("/api/")) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.json({ error: "Permisos insuficientes." }, { status: 403 });
  }

  // Only the validated session can provide the pilot's internal legacy credential.
  const headers = new Headers(request.headers);
  const pilotPassword = process.env.DENTAL_APP_PASSWORD;
  if (!pilotPassword || pilotPassword.length < 16) return unauthorizedResponse(pathname.startsWith("/api/"));
  headers.set("authorization", `Basic ${Buffer.from(`clinica:${pilotPassword}`).toString("base64")}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
