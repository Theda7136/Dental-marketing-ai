import { cookies } from "next/headers";
import { getStudioAccess } from "@/lib/studioAccess";
import { STUDIO_SESSION_COOKIE } from "@/lib/studioSession";
import { isValidOAuthCallback } from "@/lib/socialOAuthState";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePageInstagramAccount } from "@/lib/instagramAccount";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state") || "";
  const storedState = request.cookies.get("meta_oauth_state")?.value || "";
  const session = await getStudioAccess("connections:manage");
  const sessionToken = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value || "";
  const validState = Boolean(session) && isValidOAuthCallback(
    "meta", receivedState, storedState,
    request.cookies.get("meta_oauth_binding")?.value || "",
    sessionToken, session?.clinic.id || "", session?.user.id || "",
  );

  const redirectWithError = (error: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard?error=${error}`, request.url));
    response.cookies.set("meta_oauth_binding", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/meta/callback", maxAge: 0 });
    response.cookies.set("meta_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/meta/callback",
      maxAge: 0,
    });
    return response;
  };

  if (!validState) {
    return redirectWithError("invalid_state");
  }

  if (!code) {
    return redirectWithError("no_code");
  }

  try {
    const appId = process.env.META_CLIENT_ID;
    const appSecret = process.env.META_CLIENT_SECRET;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = process.env.META_REDIRECT_URI || new URL("/api/auth/meta/callback", baseUrl).toString();

    // 1. Canjear el código por el token de acceso
    const tokenRes = await fetch(
      `https://graph.facebook.com/v26.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    const shortLivedUserToken = tokenData.access_token as string | undefined;

    if (!tokenRes.ok || !shortLivedUserToken) {
      console.error("Meta no devolvió un token de acceso.");
      return redirectWithError("token_failed");
    }

    // 2. Intercambiar el token temporal antes de solicitar el token de la Página.
    const exchangeUrl = new URL("https://graph.facebook.com/v26.0/oauth/access_token");
    exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchangeUrl.searchParams.set("client_id", appId || "");
    exchangeUrl.searchParams.set("client_secret", appSecret || "");
    exchangeUrl.searchParams.set("fb_exchange_token", shortLivedUserToken);
    const exchangeRes = await fetch(exchangeUrl, { signal: AbortSignal.timeout(30_000) });
    const exchangeData = await exchangeRes.json();
    const userAccessToken = exchangeData.access_token as string | undefined;

    if (!exchangeRes.ok || !userAccessToken) {
      console.error("Meta no permitió extender el token temporal.");
      return redirectWithError("token_exchange_failed");
    }

    // 3. Consultar el perfil del usuario y, por separado, las Páginas que administra.
    const userUrl = new URL("https://graph.facebook.com/v26.0/me");
    userUrl.searchParams.set("fields", "id,name");
    userUrl.searchParams.set("access_token", userAccessToken);
    const userRes = await fetch(userUrl, { signal: AbortSignal.timeout(30_000) });
    const userData = await userRes.json();
    if (!userRes.ok || userData.error || !userData.id) {
      console.error("Meta no permitió consultar el perfil de la cuenta.");
      return redirectWithError("pages_failed");
    }

    const pagesUrl = new URL("https://graph.facebook.com/v26.0/me/accounts");
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account");
    pagesUrl.searchParams.set("access_token", userAccessToken);
    const pagesRes = await fetch(pagesUrl, { signal: AbortSignal.timeout(30_000) });
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok || pagesData.error) {
      console.error("Meta no permitió consultar las páginas de la cuenta.");
      return redirectWithError("pages_failed");
    }

    const pages = Array.isArray(pagesData.data) ? pagesData.data : [];
    const configuredPageId = process.env.META_PAGE_ID?.trim();
    if (pages.length > 1 && !configuredPageId) {
      return redirectWithError("multiple_pages");
    }
    const page = configuredPageId
      ? pages.find((candidate: { id?: string }) => candidate.id === configuredPageId)
      : pages[0];
    if (!page?.id || !page?.access_token) {
      return redirectWithError(configuredPageId ? "page_not_found" : "no_page");
    }
    const providerAccountId = userData.id;
    let instagramId: string | null = page.instagram_business_account?.id || null;
    try {
      instagramId = await resolvePageInstagramAccount(page.id, page.access_token);
    } catch (error) {
      console.warn("Meta no permitió verificar Instagram directamente en la Página:", error);
    }

    const existingAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: "facebook", providerAccountId: providerAccountId } },
      select: { clinicId: true },
    });
    if (existingAccount && existingAccount.clinicId !== session!.clinic.id) {
      return redirectWithError("account_already_linked");
    }

    const accountFields = {
      accessToken: page.access_token,
      name: userData.name || "Usuario Meta",
      pageName: page.name || "Página de Facebook",
      pageId: page.id,
      instagramId,
    };
    if (existingAccount) {
      const updated = await prisma.account.updateMany({
        where: { provider: "facebook", providerAccountId, clinicId: session!.clinic.id },
        data: accountFields,
      });
      if (updated.count !== 1) return redirectWithError("account_already_linked");
    } else {
      try {
        await prisma.account.create({
          data: {
            provider: "facebook",
            providerAccountId,
            clinicId: session!.clinic.id,
            ...accountFields,
          },
        });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P2002") {
          return redirectWithError("account_already_linked");
        }
        throw error;
      }
    }

    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    response.cookies.set("meta_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/meta/callback", maxAge: 0 });
    return response;
  } catch (error: any) {
    console.error("ERROR EN CALLBACK DE META:", error?.message || "Error desconocido");
    return redirectWithError("db_error");
  }
}