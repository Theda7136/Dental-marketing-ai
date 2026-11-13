import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studioAccess";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getStudioAccess("content:write");
  if (!session) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return NextResponse.json({ message: "Identificador de publicación no válido." }, { status: 400 });
  }

  try {
    const post = await prisma.scheduledPost.findUnique({
      where: { id, clinicId: session.clinic.id },
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

    const updated = await prisma.scheduledPost.updateMany({
      where: {
        id,
        clinicId: session.clinic.id,
        archivedAt: null,
        status: post.status,
        facebookStatus: post.facebookStatus,
        instagramStatus: post.instagramStatus,
        tiktokStatus: post.tiktokStatus,
      },
      data: { archivedAt: new Date() },
    });

    if (updated.count !== 1) {
      return NextResponse.json({
        message: "La publicación cambió de estado. Recarga el panel antes de continuar.",
      }, { status: 409 });
    }

    return NextResponse.json({ ok: true, message: "Publicación archivada en el panel. Las publicaciones en redes sociales no se eliminan." });
  } catch (error) {
    console.error("No se pudo archivar la publicación:", error);
    return NextResponse.json(
      { message: "No se pudo retirar la publicación. Inténtalo nuevamente." },
      { status: 500 },
    );
  }
}
