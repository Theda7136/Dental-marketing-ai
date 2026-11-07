import { prisma } from "@/lib/prisma";
import { createSignedMediaUrl } from "@/lib/mediaSignature";

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

export async function publishToMeta(post: PublishPost) {
  if (post.mediaKind !== "image" && post.mediaKind !== "video") throw new Error("El tipo de archivo no se puede publicar en Meta.");
  const account = await prisma.account.findFirst({ where: { provider: "facebook" } });
  if (!account?.accessToken || !account.pageId) throw new Error("Vuelve a conectar la Página de Meta desde el panel.");
  const token = account.accessToken;
  const mediaUrl = createSignedMediaUrl(post.id, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  const results: { instagramId?: string; facebookId?: string } = {};
  const isVideo = post.mediaKind === "video";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (account.instagramId) {
    try {
      const creation = await graphPost(`${account.instagramId}/media`, isVideo
        ? { media_type: "REELS", video_url: mediaUrl, caption: post.generatedCaption, share_to_feed: "true", access_token: token }
        : { image_url: mediaUrl, caption: post.generatedCaption, access_token: token });
      if (!creation.id) throw new Error("Meta no devolvió el identificador de la publicación de Instagram.");
      if (isVideo) await waitForInstagramContainer(creation.id, token);
      const published = await graphPost(`${account.instagramId}/media_publish`, { creation_id: creation.id, access_token: token });
      if (published.id) results.instagramId = published.id;
    } catch (error) { errors.push(error instanceof Error ? error.message : "Falló Instagram."); }
  }

  try {
    if (isVideo) {
      const started = await graphPost(`${account.pageId}/video_reels`, { upload_phase: "start", access_token: token });
      if (!started.video_id || !started.upload_url) throw new Error("Meta no inició la carga del Reel de Facebook.");
      const upload = await fetch(started.upload_url, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, file_url: mediaUrl },
        signal: AbortSignal.timeout(120_000),
      });
      const uploadData = await upload.json() as GraphResult;
      if (!upload.ok || uploadData.error || uploadData.success === false) throw new Error(`Meta: ${uploadData.error?.message || "no se pudo cargar el video de Facebook."}`);
      const finished = await graphPost(`${account.pageId}/video_reels`, { video_id: String(started.video_id), upload_phase: "finish", video_state: "PUBLISHED", description: post.generatedCaption, access_token: token });
      if (finished.success === false || finished.error) throw new Error(`Meta: ${finished.error?.message || "no se pudo publicar el Reel de Facebook."}`);
      results.facebookId = String(started.video_id);
      try {
        const status = await graphGet(String(started.video_id), token, "status");
        const publishingStatus = status.status?.publishing_phase?.status;
        if (publishingStatus !== "complete") {
          warnings.push("Meta aceptó el Reel de Facebook y todavía lo está procesando. Revisa la Página antes de intentar publicarlo de nuevo.");
        }
      } catch {
        warnings.push("Meta aceptó el Reel de Facebook, pero no se pudo confirmar su estado final. Revisa la Página antes de intentar publicarlo de nuevo.");
      }
    } else {
      const published = await graphPost(`${account.pageId}/photos`, { url: mediaUrl, caption: post.generatedCaption, access_token: token });
      if (published.id) results.facebookId = published.id;
    }
  } catch (error) { errors.push(error instanceof Error ? error.message : "Falló Facebook."); }

  if (!results.instagramId && !results.facebookId) {
    throw new Error(errors.join(" ") || "No se pudo completar la publicación en Instagram ni en Facebook.");
  }

  warnings.push(...errors);
  if (!account.instagramId) {
    warnings.push("La Página no tiene Instagram Business vinculado; se publicó solo en Facebook.");
  }
  return { success: true, ...results, ...(warnings.length ? { warnings } : {}) };
}
