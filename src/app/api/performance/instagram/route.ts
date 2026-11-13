import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstagramMetrics = {
  id: string;
  likes: number;
  comments: number;
};

export async function GET() {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const account = await prisma.account.findFirst({
    where: { clinicId: session.clinic.id, provider: "facebook" },
    select: { accessToken: true, instagramId: true },
  });
  if (!account?.accessToken || !account.instagramId) {
    return NextResponse.json({ error: "Conecta Instagram para consultar las interacciones." }, { status: 409 });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: {
      clinicId: session.clinic.id,
      archivedAt: null,
      instagramStatus: "SUCCEEDED",
      instagramPostId: { not: null },
      deliveryFormat: { not: "STORY" },
    },
    select: { id: true, instagramPostId: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const metrics: InstagramMetrics[] = [];
  let unavailable = 0;
  const failures: Record<string, number> = {};
  for (const post of posts) {
    const mediaId = post.instagramPostId;
    if (!mediaId || !/^\d+$/.test(mediaId)) {
      failures.identifier = (failures.identifier ?? 0) + 1;
      unavailable++;
      continue;
    }

    const url = new URL(`https://graph.facebook.com/v26.0/${mediaId}`);
    url.searchParams.set("fields", "id,like_count,comments_count");
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${account.accessToken}` },
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
      if (String(entry.id) !== mediaId ||
        typeof entry.like_count !== "number" || typeof entry.comments_count !== "number") {
        failures.incomplete = (failures.incomplete ?? 0) + 1;
        unavailable++;
        continue;
      }
      metrics.push({
        id: post.id,
        likes: entry.like_count,
        comments: entry.comments_count,
      });
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
    scope: "Últimas 10 publicaciones confirmadas de Instagram, excepto Historias",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
