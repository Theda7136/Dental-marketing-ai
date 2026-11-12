import { prisma } from "@/lib/prisma";
import { createSignedMediaUrl } from "@/lib/mediaSignature";
import { getTikTokAccess, getTikTokCreator, tikTokRequest } from "@/lib/tiktok";

function publicMediaBase() {
  const configured = process.env.TIKTOK_PUBLIC_MEDIA_URL?.trim();
  if (!configured) {
    throw new Error("Configura TIKTOK_PUBLIC_MEDIA_URL con un dominio HTTPS verificado en TikTok.");
  }
  const url = new URL(configured);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.hostname.endsWith(".trycloudflare.com")) {
    throw new Error("TikTok necesita una URL HTTPS de dominio verificado; un túnel temporal no sirve.");
  }
  return configured;
}

export async function publishToTikTok(postId: string, privacy: string) {
  const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
  if (!post || post.archivedAt || !post.mediaUrl) throw new Error("Propuesta no disponible para TikTok.");
  if (post.tiktokStatus !== "PENDING") {
    throw new Error("TikTok ya recibió un intento para esta propuesta. Comprueba su estado antes de reenviarla.");
  }
  if (!["PENDING_APPROVAL", "PUBLISHED"].includes(post.status)) {
    throw new Error("La propuesta no está disponible para publicar.");
  }
  const { creator, token } = await getTikTokCreator();
  if (!creator.privacy_level_options.includes(privacy)) {
    throw new Error("La privacidad seleccionada no está permitida en esta cuenta de TikTok.");
  }
  const mediaUrl = createSignedMediaUrl(post.id, publicMediaBase());
  const isVideo = post.mediaType === "VIDEO";

  const claim = await prisma.scheduledPost.updateMany({
    where: { id: postId, tiktokStatus: "PENDING", archivedAt: null },
    data: { tiktokStatus: "IN_PROGRESS", tiktokPrivacy: privacy, tiktokError: null },
  });
  if (claim.count !== 1) throw new Error("Otro envío de TikTok ya está en curso.");

  try {
    const body = isVideo
      ? {
          post_info: {
            title: post.generatedCaption.slice(0, 2200), privacy_level: privacy,
            disable_comment: Boolean(creator.comment_disabled),
            disable_duet: Boolean(creator.duet_disabled),
            disable_stitch: Boolean(creator.stitch_disabled),
            brand_organic_toggle: true,
            brand_content_toggle: false,
          },
          source_info: { source: "PULL_FROM_URL", video_url: mediaUrl },
        }
      : {
          post_mode: "DIRECT_POST", media_type: "PHOTO",
          post_info: {
            title: post.procedureName.slice(0, 90),
            description: post.generatedCaption.slice(0, 4000),
            privacy_level: privacy,
            disable_comment: Boolean(creator.comment_disabled),
            auto_add_music: false,
            brand_organic_toggle: true,
            brand_content_toggle: false,
          },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [mediaUrl] },
        };
    const endpoint = isVideo ? "/v2/post/publish/video/init/" : "/v2/post/publish/content/init/";
    const initiated = await tikTokRequest<{ publish_id: string }>(endpoint, token, body);
    if (!initiated.publish_id) throw new Error("TikTok no devolvió un identificador para el envío.");
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        tiktokStatus: "PROCESSING",
        tiktokPublishId: initiated.publish_id,
        ...(post.status === "PENDING_APPROVAL" ? { approvedAt: new Date() } : {}),
      },
    });
    return { status: "PROCESSING", publishId: initiated.publish_id };
  } catch (error) {
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { tiktokStatus: "UNKNOWN", tiktokError: error instanceof Error ? error.message.slice(0, 400) : "Resultado no confirmado." },
    });
    throw error;
  }
}

export async function refreshTikTokPostStatus(postId: string) {
  const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
  if (!post?.tiktokPublishId || !["PROCESSING", "IN_PROGRESS"].includes(post.tiktokStatus)) {
    throw new Error("No existe una publicación de TikTok pendiente de comprobación.");
  }
  const { token } = await getTikTokAccess();
  const status = await tikTokRequest<{ status?: string; fail_reason?: string }>(
    "/v2/post/publish/status/fetch/", token, { publish_id: post.tiktokPublishId },
  );
  const completed = status.status === "PUBLISH_COMPLETE";
  const failed = status.status === "FAILED";
  await prisma.scheduledPost.update({
    where: { id: postId },
    data: {
      tiktokStatus: completed ? "SUCCEEDED" : failed ? "FAILED" : "PROCESSING",
      ...(completed && post.status === "PENDING_APPROVAL" ? { status: "PUBLISHED" } : {}),
      tiktokError: failed ? (status.fail_reason || "TikTok rechazó el envío.").slice(0, 400) : null,
    },
  });
  return { status: completed ? "SUCCEEDED" : failed ? "FAILED" : "PROCESSING", message: status.fail_reason };
}
