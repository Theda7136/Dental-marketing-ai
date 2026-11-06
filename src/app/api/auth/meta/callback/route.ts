import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard?error=no_code", request.url));
  }

  try {
    const appId = process.env.META_CLIENT_ID;
    const appSecret = process.env.META_CLIENT_SECRET;
    const redirectUri = "http://localhost:3000/api/auth/meta/callback";

    // 1. Canjear el código por el token de acceso
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;

    if (!userAccessToken) {
      console.error("Error al obtener token de Meta:", tokenData);
      return NextResponse.redirect(new URL("/dashboard?error=token_failed", request.url));
    }

    // 2. Obtener datos del usuario y de su página de Facebook
    const userRes = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,accounts{name,access_token,instagram_business_account}&access_token=${userAccessToken}`
    );
    const userData = await userRes.json();

    const page = userData.accounts?.data?.[0];
    const providerAccountId = userData.id || "meta_user_id";

    // 3. Guardar o actualizar de forma segura usando el índice único de Prisma
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "facebook",
          providerAccountId: providerAccountId,
        },
      },
      update: {
        accessToken: page ? page.access_token : userAccessToken,
        name: userData.name || "Usuario Meta",
        pageName: page ? page.name : "Clínica Dental",
        pageId: page ? page.id : null,
        instagramId: page?.instagram_business_account?.id || null,
      },
      create: {
        provider: "facebook",
        providerAccountId: providerAccountId,
        accessToken: page ? page.access_token : userAccessToken,
        name: userData.name || "Usuario Meta",
        pageName: page ? page.name : "Clínica Dental",
        pageId: page ? page.id : null,
        instagramId: page?.instagram_business_account?.id || null,
      },
    });

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error: any) {
    console.error("ERROR CRÍTICO EN CALLBACK:", error?.message || error);
    return NextResponse.redirect(new URL("/dashboard?error=db_error", request.url));
  }
}