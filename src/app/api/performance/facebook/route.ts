import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudioAccess } from "@/lib/studioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FacebookMetrics = {
  id: string;
  reactions: number | null;
  comments: number | null;
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
type MetricState = "zero" | "available" | "omitted" | "rejected" | "unavailable";
type Diagnostic = { photo: number; reactions: MetricState; comments: MetricState };

function metricState(total: number | null, failure?: Failure): MetricState {
  if (total === 0) return "zero";
  if (total !== null) return "available";
  if (failure === "incomplete") return "omitted";
  if (failure === "permissions" || failure === "token" || failure === "identifier") return "rejected";
  return "unavailable";
}

function classifyFailure(code?: number): Failure {
  if (code === 190) return "token";
  if (code === 10 || code === 200 || code === 283) return "permissions";
  if (code === 100) return "incomplete";
  return "unavailable";
}

async function fetchMeta(
  objectId: string,
  fields: string,
  token: string,
): Promise<{ value: MetaResponse | null; failure?: Failure }> {
  const url = new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(objectId)}`);
  url.searchParams.set("fields", fields);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json() as MetaResponse;
    if (!response.ok || payload.error) {
      return { value: null, failure: classifyFailure(payload.error?.code) };
    }
    return String(payload.id) === objectId
      ? { value: payload }
      : { value: null, failure: "identifier" };
  } catch {
    return { value: null, failure: "unavailable" };
  }
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function getCount(
  objectId: string,
  field: "reactions" | "likes" | "comments",
  token: string,
): Promise<{ total: number | null; failure?: Failure }> {
  const summary = field === "reactions" ? "total_count" : "true";
  const response = await fetchMeta(objectId, `id,${field}.limit(0).summary(${summary})`, token);
  if (!response.value) return { total: null, failure: response.failure ?? "unavailable" };
  const total = count(response.value[field]?.summary?.total_count);
  return total === null ? { total: null, failure: "incomplete" } : { total };
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
  const diagnostics: Diagnostic[] = [];
  const failures: Record<string, number> = {};

  for (const [index, post] of posts.entries()) {
    const photoId = post.facebookPostId;
    if (!photoId || !/^\d+(?:_\d+)?$/.test(photoId)) {
      failures.identifier = (failures.identifier ?? 0) + 1;
      diagnostics.push({ photo: index + 1, reactions: "rejected", comments: "rejected" });
      continue;
    }

    const photo = await fetchMeta(photoId, "id,page_story_id", account.accessToken);
    if (!photo.value) {
      const reason = photo.failure ?? "unavailable";
      failures[reason] = (failures[reason] ?? 0) + 1;
      const state = metricState(null, reason);
      diagnostics.push({ photo: index + 1, reactions: state, comments: state });
      continue;
    }

    const storyId = photo.value.page_story_id;
    const validStoryId = storyId && /^\d+_\d+$/.test(storyId) ? storyId : null;

    // Facebook /photos returns a Photo ID. Reactions belong to the associated
    // page post when it exists; photo likes are a useful independent fallback.
    const storyReactions = validStoryId
      ? await getCount(validStoryId, "reactions", account.accessToken)
      : null;
    const reactions = storyReactions?.total !== null && storyReactions?.total !== undefined
      ? storyReactions
      : await getCount(photoId, "likes", account.accessToken);
    const source = storyReactions?.total !== null && storyReactions?.total !== undefined
      ? "reactions" as const : "likes" as const;

    const storyComments = validStoryId
      ? await getCount(validStoryId, "comments", account.accessToken)
      : null;
    const comments = storyComments?.total !== null && storyComments?.total !== undefined
      ? storyComments
      : await getCount(photoId, "comments", account.accessToken);

    diagnostics.push({
      photo: index + 1,
      reactions: metricState(reactions.total, reactions.failure),
      comments: metricState(comments.total, comments.failure),
    });
    if (reactions.total !== null || comments.total !== null) {
      metrics.push({ id: post.id, reactions: reactions.total, comments: comments.total, source });
    }
    for (const metric of [reactions, comments]) {
      if (metric.total === null) {
        const reason = metric.failure ?? "incomplete";
        failures[reason] = (failures[reason] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    metrics,
    checked: posts.length,
    unavailable: posts.length - metrics.filter((entry) =>
      entry.reactions !== null && entry.comments !== null,
    ).length,
    failures,
    diagnostics,
    scope: "Últimas 10 fotografías confirmadas del Feed de Facebook",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
