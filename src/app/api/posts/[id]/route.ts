import { NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) {
    return unauthorizedResponse(true);
  }

  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return NextResponse.json({ message: "Identificador de publicación no válido." }, { status: 400 });
  }

  try {
    const post = await prisma.scheduledPost.findUnique({
      where: { id },
      select: {
        status: true,
        archivedAt: true,
        facebookStatus: true,
        instagramStatus: true,
        tiktokStatus: true,
        facebookPostId: true,
        instagramPostId: true,
        facebookRetryCount: true,
        instagramRetryCount: true,
      },
    });

    if (!post || post.archivedAt) {
      return NextResponse.json({ message: "La publicación no existe o ya fue retirada de la lista." }, { status: 404 });
    }

    const pending = post.status === "PENDING_APPROVAL";
    const untouched = post.facebookStatus === "PENDING" &&
      post.instagramStatus === "PENDING" &&
      !post.facebookPostId && !post.instagramPostId &&
      post.facebookRetryCount === 0 && post.instagramRetryCount === 0;

    if ([post.facebookStatus, post.instagramStatus].some((status) =>
      status === "UNKNOWN" || status === "IN_PROGRESS"
    ) || ["IN_PROGRESS", "PROCESSING", "UNKNOWN"].includes(post.tiktokStatus) || (pending && !untouched)) {
      return NextResponse.json({
        message: "Esta publicación tiene envíos iniciados o pendientes de verificación en Meta. Resuelve primero sus estados.",
      }, { status: 409 });
    }

    const updated = await prisma.scheduledPost.updateMany({
      where: {
        id,
        archivedAt: null,
        status: post.status,
        facebookStatus: post.facebookStatus,
        instagramStatus: post.instagramStatus,
        tiktokStatus: post.tiktokStatus,
        ...(pending ? {
          facebookRetryCount: 0,
          instagramRetryCount: 0,
          facebookPostId: null,
          instagramPostId: null,
        } : {}),
      },
      data: { archivedAt: new Date() },
    });

    if (updated.count !== 1) {
      return NextResponse.json({
        message: "La publicación cambió de estado. Recarga el panel antes de continuar.",
      }, { status: 409 });
    }

    return NextResponse.json({ ok: true, message: "Publicación retirada de la lista." });
  } catch (error) {
    console.error("No se pudo archivar la publicación:", error);
    return NextResponse.json(
      { message: "No se pudo retirar la publicación. Inténtalo nuevamente." },
      { status: 500 },
    );
  }
}
