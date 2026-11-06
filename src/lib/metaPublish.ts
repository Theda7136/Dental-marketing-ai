import { prisma } from "@/lib/prisma";

export async function publishToMeta(post: { id: string; mediaUrl: string; generatedCaption: string; mediaKind: string }) {
  // 1. Obtener las credenciales de la cuenta usando el modelo Account
  const account = await prisma.account.findFirst({
    where: { provider: "meta" },
  });

  if (!account || !account.accessToken) {
    throw new Error("No hay una cuenta de Meta vinculada en la base de datos.");
  }

  const accessToken = account.accessToken;

  // 2. Obtener las páginas de Facebook y las cuentas de Instagram Business asociadas
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${accessToken}`
  );
  const pagesData = await pagesRes.json();

  if (pagesData.error) {
    throw new Error(`Error al obtener páginas de Meta: ${pagesData.error.message}`);
  }

  const connectedPage = pagesData.data?.[0]; // Tomamos la primera página disponible
  
  if (!connectedPage) {
    throw new Error("No se encontró ninguna Página de Facebook administrada por este usuario.");
  }

  const pageId = connectedPage.id;
  const pageAccessToken = connectedPage.access_token || accessToken;
  const igUserId = connectedPage.instagram_business_account?.id;

  const results: { instagramId?: string; facebookId?: string } = {};

  // --- A. PUBLICAR EN INSTAGRAM (Si tiene cuenta de Business vinculada) ---
  if (igUserId) {
    // Paso 1: Crear contenedor multimedia en Instagram
    const igCreationRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
      method: "POST",
      body: new URLSearchParams({
        image_url: post.mediaUrl,
        caption: post.generatedCaption,
        access_token: pageAccessToken,
      }),
    });
    const igCreationData = await igCreationRes.json();

    if (!igCreationData.error) {
      // Paso 2: Publicar el contenedor
      const igPublishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
        method: "POST",
        body: new URLSearchParams({
          creation_id: igCreationData.id,
          access_token: pageAccessToken,
        }),
      });
      const igPublishData = await igPublishRes.json();
      if (!igPublishData.error) {
        results.instagramId = igPublishData.id;
      }
    }
  }

  // --- B. PUBLICAR EN LA PÁGINA DE FACEBOOK ---
  const fbPublishRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: "POST",
    body: new URLSearchParams({
      url: post.mediaUrl,
      caption: post.generatedCaption,
      access_token: pageAccessToken,
    }),
  });
  const fbPublishData = await fbPublishRes.json();

  if (!fbPublishData.error) {
    results.facebookId = fbPublishData.id;
  }

  // Validar si al menos se publicó en un canal
  if (!results.instagramId && !results.facebookId) {
    throw new Error("No se pudo completar la publicación ni en Instagram ni en Facebook.");
  }

  return { success: true, ...results };
}