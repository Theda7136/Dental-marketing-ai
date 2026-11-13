import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getStudioAccess("content:read");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  try {
    const posts = await prisma.scheduledPost.findMany({
      where: { clinicId: session.clinic.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      posts: posts.map((post: {
        id: string;
        procedureName: string;
        mediaUrl: string;
        generatedCaption: string;
        educationalCaption: string | null;
        commercialCaption: string | null;
        selectedStyle: string;
        visualSummary: string | null;
        status: string;
        createdAt: Date;
        approvedAt: Date | null;
        scheduledFor: Date | null;
        clinicalVerifiedAt: Date | null;
        mediaType: string;
        deliveryFormat: string;
        facebookStatus: string;
        instagramStatus: string;
        facebookPostId: string | null;
        instagramPostId: string | null;
        tiktokStatus: string;
        tiktokPublishId: string | null;
        tiktokError: string | null;
        facebookReviewOutcome: string | null;
        facebookReviewEvidence: string | null;
        facebookReviewedAt: Date | null;
        instagramReviewOutcome: string | null;
        instagramReviewEvidence: string | null;
        instagramReviewedAt: Date | null;
        facebookRetryCount: number;
        instagramRetryCount: number;
        instagramError: string | null;
      }) => ({
        id: post.id,
        procedureName: post.procedureName,
        mediaUrl: post.mediaUrl,
        deliveryFormat: post.deliveryFormat,
        generatedCaption: post.generatedCaption,
        educationalCaption: post.educationalCaption,
        commercialCaption: post.commercialCaption,
        selectedStyle: post.selectedStyle,
        visualSummary: post.visualSummary,
        status: post.status,
        facebookStatus: post.facebookStatus,
        instagramStatus: post.instagramStatus,
        facebookPostId: post.facebookPostId,
        facebookRetryCount: post.facebookRetryCount,
        instagramRetryCount: post.instagramRetryCount,
        canRecoverRejectedStory: post.mediaType === "IMAGE" && post.deliveryFormat === "STORY" &&
          post.instagramStatus === "UNKNOWN" && post.instagramRetryCount === 0 && !post.instagramPostId &&
          Boolean(post.instagramError?.includes("Only photo or video can be accepted as media type.")),
        instagramPostId: post.instagramPostId,
        tiktokStatus: post.tiktokStatus,
        tiktokPublishId: post.tiktokPublishId,
        tiktokError: post.tiktokError,
        facebookReviewOutcome: post.facebookReviewOutcome,
        facebookReviewEvidence: post.facebookReviewEvidence,
        facebookReviewedAt: post.facebookReviewedAt?.toISOString() ?? null,
        instagramReviewOutcome: post.instagramReviewOutcome,
        instagramReviewEvidence: post.instagramReviewEvidence,
        instagramReviewedAt: post.instagramReviewedAt?.toISOString() ?? null,
        createdAt: post.createdAt.toISOString(),
        approvedAt: post.approvedAt?.toISOString() ?? null,
        scheduledFor: post.scheduledFor?.toISOString() ?? null,
        clinicalVerifiedAt: post.clinicalVerifiedAt?.toISOString() ?? null,
        mediaKind: post.mediaUrl.length === 0
          ? "text"
          : post.mediaType === "VIDEO"
            ? "video"
            : "image",
      })),
    });
  } catch (error) {
    console.error("Error al cargar la cola de publicaciones:", error);
    return NextResponse.json(
      { error: { code: "POSTS_UNAVAILABLE", message: "No se pudieron cargar las publicaciones." } },
      { status: 503 },
    );
  }
}
