const GRAPH_VERSION = "v26.0";

type PageInstagramData = {
  id?: string;
  instagram_business_account?: { id?: string; username?: string };
  connected_instagram_account?: { id?: string };
  error?: { code?: number; message?: string };
};

export async function resolvePageInstagramAccount(
  pageId: string,
  pageAccessToken: string,
  request: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}`);
  url.searchParams.set("fields", "id,instagram_business_account{id,username}");
  const response = await request(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const page = await response.json() as PageInstagramData;
  if (!response.ok || page.error) {
    throw new Error("No se pudo verificar la vinculación de Instagram mediante Meta Graph API.");
  }
  if (page.id !== pageId) {
    throw new Error("Meta respondió con una Página distinta de la configurada.");
  }
  return page.instagram_business_account?.id || null;
}
