import { NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) {
    return unauthorizedResponse(true);
  }

  try {
    const posts = await prisma.scheduledPost.findMany({
      where: { archivedAt: null },
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
        mediaType: string;
        facebookStatus: string;
        instagramStatus: string;
        facebookPostId: string | null;
        instagramPostId: string | null;
        facebookReviewOutcome: string | null;
        facebookReviewEvidence: string | null;
        facebookReviewedAt: Date | null;
        instagramReviewOutcome: string | null;
        instagramReviewEvidence: string | null;
        instagramReviewedAt: Date | null;
        facebookRetryCount: number;
        instagramRetryCount: number;
      }) => ({
        id: post.id,
        procedureName: post.procedureName,
        mediaUrl: post.mediaUrl,
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
        instagramPostId: post.instagramPostId,
        facebookReviewOutcome: post.facebookReviewOutcome,
        facebookReviewEvidence: post.facebookReviewEvidence,
        facebookReviewedAt: post.facebookReviewedAt?.toISOString() ?? null,
        instagramReviewOutcome: post.instagramReviewOutcome,
        instagramReviewEvidence: post.instagramReviewEvidence,
        instagramReviewedAt: post.instagramReviewedAt?.toISOString() ?? null,
        createdAt: post.createdAt.toISOString(),
        approvedAt: post.approvedAt?.toISOString() ?? null,
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
