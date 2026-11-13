import { prisma } from "@/lib/prisma";

type Network = "facebook" | "instagram";

export type MetaLookupResult =
  | { ok: true; message: string; objectId: string; checkedAt: string }
  | { ok: false; message: string };

const GRAPH_BASE = "https://graph.facebook.com/v26.0";

export async function inspectMetaObject(
  postId: string,
  network: Network,
): Promise<MetaLookupResult> {
  if (network !== "facebook" && network !== "instagram") {
    return { ok: false, message: "Red social no válida." };
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId, clinicId: "pilot" },
    select: {
      facebookPostId: true,
      instagramPostId: true,
    },
  });
  const objectId = network === "facebook" ? post?.facebookPostId : post?.instagramPostId;
  if (!objectId) {
    return {
      ok: false,
      message: "Este registro no tiene un identificador confirmado de Meta. Revisa la publicación manualmente; no se puede deducir que no fue publicada.",
    };
  }
  if (!/^[0-9]+(?:_[0-9]+)?$/.test(objectId)) {
    return { ok: false, message: "El identificador guardado no tiene un formato válido." };
  }

  const account = await prisma.account.findFirst({
    where: { provider: "facebook", clinicId: "pilot" },
    select: { accessToken: true },
  });
  if (!account?.accessToken) {
    return { ok: false, message: "Vuelve a conectar Meta para comprobar este identificador." };
  }

  const url = new URL(`${GRAPH_BASE}/${objectId}`);
  url.searchParams.set("fields", "id");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: "Meta no permitió consultar el identificador. Puede deberse a permisos, acceso, eliminación o disponibilidad; no significa que no se haya publicado.",
      };
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("id" in payload) || String(payload.id) !== objectId) {
      return { ok: false, message: "Meta no devolvió el identificador esperado. Comprueba el registro manualmente." };
    }

    return {
      ok: true,
      objectId,
      checkedAt: new Date().toISOString(),
      message: "Meta reconoce el identificador. Esto no garantiza que el contenido sea público ni que un video haya terminado de procesarse.",
    };
  } catch {
    return {
      ok: false,
      message: "No se pudo completar la consulta de solo lectura. El resultado de publicación permanece sin cambios.",
    };
  }
}
