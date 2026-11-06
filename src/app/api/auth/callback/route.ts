import { NextRequest, NextResponse } from "next/server";
// import { db } from "@/lib/db"; // Tu cliente de base de datos Prisma

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/dashboard?error=auth_denied", request.url));
  }

  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`;

  try {
    // 1. Intercambiar el código temporal por un token de acceso
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&client_secret=${clientSecret}&code=${code}`
    );

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error("No se pudo obtener el token de acceso.");
    }

    const shortLivedToken = tokenData.access_token;

    // 2. Intercambiar por un token de larga duración (60 días)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${shortLivedToken}`
    );
    const longLivedData = await longLivedRes.json();
    const accessToken = longLivedData.access_token || shortLivedToken;

    // 3. Obtener las páginas de Facebook vinculadas y su cuenta de Instagram Business asociada
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
    );
    const pagesData = await pagesRes.json();

    // Tomamos la primera página y su Instagram Business Account ID correspondiente
    const primaryPage = pagesData.data?.[0];
    if (primaryPage) {
      const igRes = await fetch(
        `https://graph.facebook.com/v19.0/${primaryPage.id}?fields=instagram_business_account&access_token=${primaryPage.access_token}`
      );
      const igData = await igRes.json();
      const instagramAccountId = igData.instagram_business_account?.id;

      // 4. Guardar las credenciales en la base de datos asociadas a la clínica
      /* 
      await db.clinicSettings.upsert({
        where: { id: "default_clinic" },
        update: {
          metaAccessToken: primaryPage.access_token,
          instagramAccountId: instagramAccountId,
        },
        create: {
          id: "default_clinic",
          metaAccessToken: primaryPage.access_token,
          instagramAccountId: instagramAccountId,
        },
      });
      */
    }

    return NextResponse.redirect(new URL("/dashboard?success=account_connected", request.url));
  } catch (err) {
    console.error("Error en OAuth callback:", err);
    return NextResponse.redirect(new URL("/dashboard?error=auth_failed", request.url));
  }
}