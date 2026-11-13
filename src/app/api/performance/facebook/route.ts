import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FacebookMetrics = {
  id: string;
  reactions: number;
  comments: number;
  source: "reactions" | "likes";
};

type MetaResponse = {
  id?: string;
  page_story_id?: string;
  reactions?: { summary?: { total_count?: number } };
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  error?: { code?: number };
};

type Failure = "token" | "permissions" | "identifier" | "incomplete" | "unavailable";

function classifyFailure(code?: number): Failure {
  if (code === 190) return "token";
  if (code === 10 || code === 200 || code === 283) return "permissions";
  if (code === 100) return "incomplete";
  return "unavailable";
}

async function fetchMeta(
  objectId: string,
  fields: string,
  accessToken: string,
): Promise<{ value: MetaResponse | null; failure?: Failure }> {
  const url = new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(objectId)}`);
  url.searchParams.set("fields", fields);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json() as MetaResponse;
    if (!response.ok || payload.error) {
      return { value: null, failure: classifyFailure(payload.error?.code) };
    }
    if (String(payload.id) !== objectId) return { value: null, failure: "identifier" };
    return { value: payload };
  } catch {
    return { value: null, failure: "unavailable" };
  }
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

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
  const failures: Record<string, number> = {};

  for (const post of posts) {
    const photoId = post.facebookPostId;
    if (!photoId || !/^\d+(?:_\d+)?$/.test(photoId)) {
      failures.identifier = (failures.identifier ?? 0) + 1;
      continue;
    }

    // Facebook /photos returns a Photo ID. The page story, when present,
    // can expose reactions that are not available on the Photo node itself.
    const photo = await fetchMeta(photoId, "id,page_story_id", account.accessToken);
    if (!photo.value) {
      const reason = photo.failure ?? "unavailable";
      failures[reason] = (failures[reason] ?? 0) + 1;
      continue;
    }

    const storyId = photo.value.page_story_id;
    if (storyId && /^\d+_\d+$/.test(storyId)) {
      const story = await fetchMeta(
        storyId,
        "id,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)",
        account.accessToken,
      );
      const reactions = story.value?.reactions?.summary?.total_count;
      const comments = story.value?.comments?.summary?.total_count;
      if (count(reactions) && count(comments)) {
        metrics.push({ id: post.id, reactions, comments, source: "reactions" });
        continue;
      }
    }

    const photoEngagement = await fetchMeta(
      photoId,
      "id,likes.limit(0).summary(true),comments.limit(0).summary(true)",
      account.accessToken,
    );
    const likes = photoEngagement.value?.likes?.summary?.total_count;
    const comments = photoEngagement.value?.comments?.summary?.total_count;
    if (count(likes) && count(comments)) {
      metrics.push({ id: post.id, reactions: likes, comments, source: "likes" });
      continue;
    }

    const reason = photoEngagement.failure ?? "incomplete";
    failures[reason] = (failures[reason] ?? 0) + 1;
  }

  return NextResponse.json({
    metrics,
    checked: posts.length,
    unavailable: posts.length - metrics.length,
    failures,
    scope: "Últimas 10 fotografías confirmadas del Feed de Facebook",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
