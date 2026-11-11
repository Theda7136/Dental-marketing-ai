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
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      posts: posts.map((post: {
        id: string;
        procedureName: string;
        mediaUrl: string;
        generatedCaption: string;
        status: string;
        createdAt: Date;
        approvedAt: Date | null;
        mediaType: string;
        facebookStatus: string;
        instagramStatus: string;
        facebookPostId: string | null;
        instagramPostId: string | null;
      }) => ({
        id: post.id,
        procedureName: post.procedureName,
        mediaUrl: post.mediaUrl,
        generatedCaption: post.generatedCaption,
        status: post.status,
        facebookStatus: post.facebookStatus,
        instagramStatus: post.instagramStatus,
        facebookPostId: post.facebookPostId,
        instagramPostId: post.instagramPostId,
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
