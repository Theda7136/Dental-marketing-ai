import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FacebookMetrics = {
  id: string;
  reactions: number;
  comments: number;
};

export async function GET() {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const account = await prisma.account.findFirst({
    where: { clinicId: session.clinic.id, provider: "facebook" },
    select: { accessToken: true, pageId: true },
  });
  if (!account?.accessToken || !account.pageId) {
    return NextResponse.json({ error: "Conecta tu página de Facebook para consultar las interacciones." }, { status: 409 });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: {
      clinicId: session.clinic.id,
      archivedAt: null,
      facebookStatus: "SUCCEEDED",
      facebookPostId: { not: null },
      deliveryFormat: "FEED",
    },
    select: { id: true, facebookPostId: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const metrics: FacebookMetrics[] = [];
  let unavailable = 0;
  const failures: Record<string, number> = {};

  for (const post of posts) {
    const postId = post.facebookPostId;
    if (!postId || !/^\d+(?:_\d+)?$/.test(postId)) {
      failures.identifier = (failures.identifier ?? 0) + 1;
      unavailable++;
      continue;
    }

    const url = new URL(`https://graph.facebook.com/v26.0/${postId}`);
    url.searchParams.set("fields",
      "id,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)");
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        const metaError = errorPayload && typeof errorPayload === "object"
          ? (errorPayload as { error?: { code?: number } }).error : undefined;
        const reason = metaError?.code === 190 ? "token"
          : [10, 200, 283].includes(metaError?.code ?? -1) ? "permissions"
          : metaError?.code === 100 ? "identifier" : "unavailable";
        failures[reason] = (failures[reason] ?? 0) + 1;
        unavailable++;
        continue;
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") {
        failures.unavailable = (failures.unavailable ?? 0) + 1;
        unavailable++;
        continue;
      }

      const entry = payload as Record<string, unknown>;
      const reactions = (entry.reactions as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
      const comments = (entry.comments as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
      if (String(entry.id) !== postId || !Number.isSafeInteger(reactions) || !Number.isSafeInteger(comments) ||
        Number(reactions) < 0 || Number(comments) < 0) {
        failures.incomplete = (failures.incomplete ?? 0) + 1;
        unavailable++;
        continue;
      }
      metrics.push({ id: post.id, reactions: Number(reactions), comments: Number(comments) });
    } catch {
      failures.unavailable = (failures.unavailable ?? 0) + 1;
      unavailable++;
    }
  }

  return NextResponse.json({
    metrics,
    checked: posts.length,
    unavailable,
    failures,
    scope: "Últimas 10 publicaciones confirmadas en el Feed de Facebook",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
