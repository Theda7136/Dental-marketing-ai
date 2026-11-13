import { prisma } from "@/lib/prisma";
import { createSignedMediaUrl } from "@/lib/mediaSignature";
import { platformCaptions } from "@/lib/platformCopy.mjs";
import { canSendToNetwork } from "@/lib/metaDeliveryPolicy.mjs";

const GRAPH = "https://graph.facebook.com/v26.0";
type PublishPost = { id: string; mediaUrl: string; generatedCaption: string; mediaKind: string };
type GraphResult = Record<string, any> & { error?: { message?: string; type?: string; code?: number } };

async function graphPost(path: string, fields: Record<string, string>): Promise<GraphResult> {
  const response = await fetch(`${GRAPH}/${path}`, { method: "POST", body: new URLSearchParams(fields), signal: AbortSignal.timeout(60_000) });
  const data = await response.json() as GraphResult;
  if (!response.ok || data.error) throw new Error(`Meta: ${data.error?.message || `falló la solicitud (${response.status})`}`);
  return data;
}
async function graphGet(path: string, token: string, fields = "status_code"): Promise<GraphResult> {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = await response.json() as GraphResult;
  if (!response.ok || data.error) throw new Error(`Meta: ${data.error?.message || `falló la consulta (${response.status})`}`);
  return data;
}
async function waitForInstagramContainer(id: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < 18; attempt++) {
    const result = await graphGet(`${id}`, token);
    if (result.status_code === "FINISHED") return;
    if (["ERROR", "EXPIRED"].includes(result.status_code)) throw new Error("Meta no pudo procesar el video de Instagram.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Meta sigue procesando el video. Intenta aprobar la publicación de nuevo más tarde.");
}

export async function publishToMeta(post: PublishPost, onlyNetwork?: "facebook" | "instagram") {
  if (post.mediaKind !== "image" && post.mediaKind !== "video") {
    throw new Error("El tipo de archivo no se puede publicar en Meta.");
  }

  const account = await prisma.account.findFirst({ where: { provider: "facebook", clinicId: "pilot" } });
  if (!account?.accessToken || !account.pageId) {
    throw new Error("Vuelve a conectar la Página de Meta desde el panel.");
  }

  const savedPost = await prisma.scheduledPost.findUnique({ where: { id: post.id, clinicId: "pilot" } });
  if (!savedPost) throw new Error("La propuesta ya no existe.");
  const deliveryFormat = savedPost.deliveryFormat || "FEED";
  const isVideo = post.mediaKind === "video";
  if (deliveryFormat === "REEL" && !isVideo) {
    throw new Error("Un Reel debe estar guardado como video MP4 vertical.");
  }
  if (savedPost.archivedAt) throw new Error("La publicación está archivada y no puede enviarse a Meta.");
  if (!savedPost.clinicalVerifiedAt) throw new Error("Confirma la correspondencia clínica de la foto, el procedimiento y el texto antes de publicar.");

  if (onlyNetwork === "instagram" && !account.instagramId) {
    throw new Error("Conecta una cuenta profesional de Instagram antes de publicarla allí.");
  }

  const token = account.accessToken;
  const publicBaseUrl = process.env.META_PUBLIC_MEDIA_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const publicOrigin = new URL(publicBaseUrl);
  const blockedHost = publicOrigin.hostname === "localhost" ||
    publicOrigin.hostname.endsWith(".localhost") ||
    publicOrigin.hostname === "127.0.0.1" ||
    publicOrigin.hostname === "::1" ||
    publicOrigin.hostname === "[::1]" ||
    publicOrigin.hostname === "0.0.0.0";

  if (publicOrigin.protocol !== "https:" || blockedHost) {
    throw new Error(
      "Meta necesita una URL HTTPS pública para descargar la imagen. Configura META_PUBLIC_MEDIA_URL con una dirección HTTPS accesible desde Internet antes de publicar.",
    );
  }

  const mediaUrl = createSignedMediaUrl(post.id, publicBaseUrl);
  const instagramMedia = new URL(mediaUrl);
  if (!isVideo) instagramMedia.searchParams.set("format", "jpeg");
  const instagramMediaUrl = instagramMedia.toString();
  const captions = platformCaptions(savedPost.generatedCaption);
  const warnings: string[] = [];
  let instagramId = savedPost.instagramPostId || undefined;
  let facebookId = savedPost.facebookPostId || undefined;

  // The state is claimed before contacting Meta. An interrupted call remains blocked,
  // since Meta could have accepted a post even when our server lost its response.
  if (onlyNetwork !== "facebook" && account.instagramId && canSendToNetwork(savedPost.instagramStatus)) {
    const claim = await prisma.scheduledPost.updateMany({
      where: { id: post.id, clinicId: "pilot", instagramStatus: "PENDING" },
      data: { instagramStatus: "IN_PROGRESS", instagramError: null },
    });
    if (claim.count === 1) {
      try {
        const creation = await graphPost(`${account.instagramId}/media`, deliveryFormat === "STORY"
          ? isVideo
            ? { media_type: "STORIES", video_url: mediaUrl, access_token: token }
            : { media_type: "STORIES", image_url: instagramMediaUrl, access_token: token }
          : isVideo
            ? { media_type: "REELS", video_url: mediaUrl, caption: captions.instagram, share_to_feed: "true", access_token: token }
            : { image_url: instagramMediaUrl, caption: captions.instagram, access_token: token });
        if (!creation.id) throw new Error("Meta no devolvió el identificador del contenedor de Instagram.");
        await waitForInstagramContainer(creation.id, token);
        const published = await graphPost(`${account.instagramId}/media_publish`, {
          creation_id: creation.id,
          access_token: token,
        });
        if (!published.id) throw new Error("Meta no confirmó la publicación en Instagram.");
        instagramId = String(published.id);
        await prisma.scheduledPost.update({
          where: { id: post.id, clinicId: "pilot" },
          data: { instagramStatus: "SUCCEEDED", instagramPostId: instagramId },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo confirmar Instagram.";
        await prisma.scheduledPost.update({
          where: { id: post.id, clinicId: "pilot" },
          data: { instagramStatus: "UNKNOWN", instagramError: message.slice(0, 500) },
        });
        warnings.push("No se confirmó el resultado de Instagram. Comprueba la cuenta antes de otro intento.");
      }
    }
  } else if (onlyNetwork !== "facebook" && !account.instagramId) {
    warnings.push("Instagram Business no está vinculado; no se intentó publicar allí.");
  }

  if (onlyNetwork !== "instagram" && canSendToNetwork(savedPost.facebookStatus)) {
    const claim = await prisma.scheduledPost.updateMany({
      where: { id: post.id, clinicId: "pilot", facebookStatus: "PENDING" },
      data: { facebookStatus: "IN_PROGRESS", facebookError: null },
    });
    if (claim.count === 1) {
      try {
        if (deliveryFormat === "STORY" && !isVideo) {
          const uploaded = await graphPost(`${account.pageId}/photos`, {
            url: instagramMediaUrl,
            published: "false",
            access_token: token,
          });
          if (!uploaded.id) throw new Error("Meta no confirmó la carga de la foto para Facebook Stories.");
          const story = await graphPost(`${account.pageId}/photo_stories`, {
            photo_id: String(uploaded.id),
            access_token: token,
          });
          if (!story.post_id || story.success === false) {
            throw new Error("Meta no confirmó la historia fotográfica de Facebook.");
          }
          facebookId = String(story.post_id);
          await prisma.scheduledPost.update({
            where: { id: post.id, clinicId: "pilot" },
            data: { facebookStatus: "SUCCEEDED", facebookPostId: facebookId },
          });
        } else if (isVideo) {
          const videoEndpoint = deliveryFormat === "STORY" ? "video_stories" : "video_reels";
          const started = await graphPost(`${account.pageId}/${videoEndpoint}`, {
            upload_phase: "start",
            access_token: token,
          });
          if (!started.video_id || !started.upload_url) {
            throw new Error("Meta no inició la carga del Reel de Facebook.");
          }
          const upload = await fetch(started.upload_url, {
            method: "POST",
            headers: { Authorization: `OAuth ${token}`, file_url: mediaUrl },
            signal: AbortSignal.timeout(120_000),
          });
          const uploadData = await upload.json() as GraphResult;
          if (!upload.ok || uploadData.error || uploadData.success === false) {
            throw new Error("Meta no pudo cargar el video de Facebook.");
          }
          const finished = await graphPost(`${account.pageId}/${videoEndpoint}`, {
            video_id: String(started.video_id),
            upload_phase: "finish",
            ...(deliveryFormat === "STORY" ? {} : { video_state: "PUBLISHED", description: captions.facebook }),
            access_token: token,
          });
          if (finished.success === false || finished.error) {
            throw new Error("Meta no confirmó la publicación del Reel de Facebook.");
          }
          facebookId = String(deliveryFormat === "STORY" ? finished.post_id || started.video_id : started.video_id);
          await prisma.scheduledPost.update({
            where: { id: post.id, clinicId: "pilot" },
            data: { facebookStatus: "SUCCEEDED", facebookPostId: facebookId },
          });
          try {
            const state = await graphGet(String(started.video_id), token, "status");
            if (state.status?.publishing_phase?.status !== "complete") {
              warnings.push("Meta aceptó el Reel de Facebook y todavía puede estar procesándolo.");
            }
          } catch {
            warnings.push("Meta aceptó el Reel de Facebook, pero no se pudo consultar su procesamiento final.");
          }
        } else {
          const published = await graphPost(`${account.pageId}/photos`, {
            url: mediaUrl,
            caption: captions.facebook,
            access_token: token,
          });
          if (!published.id) throw new Error("Meta no confirmó la foto de Facebook.");
          facebookId = String(published.id);
          await prisma.scheduledPost.update({
            where: { id: post.id, clinicId: "pilot" },
            data: { facebookStatus: "SUCCEEDED", facebookPostId: facebookId },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo confirmar Facebook.";
        await prisma.scheduledPost.update({
          where: { id: post.id, clinicId: "pilot" },
          data: { facebookStatus: "UNKNOWN", facebookError: message.slice(0, 500) },
        });
        warnings.push("No se confirmó el resultado de Facebook. Comprueba la Página antes de otro intento.");
      }
    }
  }

  if (onlyNetwork === "instagram" && !instagramId) {
    throw new Error("Instagram no confirmó la publicación. Comprueba el estado en Meta antes de volver a intentar.");
  }
  if (onlyNetwork === "facebook" && !facebookId) {
    throw new Error("Facebook no confirmó la publicación. Comprueba el estado en Meta antes de volver a intentar.");
  }

  if (!instagramId && !facebookId) {
    const currentPost = await prisma.scheduledPost.findUnique({ where: { id: post.id, clinicId: "pilot" } });
    const unconfirmed = currentPost && [currentPost.facebookStatus, currentPost.instagramStatus]
      .some((status) => status === "UNKNOWN" || status === "IN_PROGRESS");

    if (unconfirmed) {
      throw new Error("No se confirmó la publicación. Hay un envío con resultado incierto; revisa Meta antes de volver a intentar.");
    }

    throw new Error(warnings.join(" ") || "No hay publicaciones confirmadas. Revisa el estado de las redes antes de continuar.");
  }

  return {
    success: true,
    ...(instagramId ? { instagramId } : {}),
    ...(facebookId ? { facebookId } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}
