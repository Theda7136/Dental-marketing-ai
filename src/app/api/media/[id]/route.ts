import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "../../../../lib/prisma";
import { isClinicAuthorized } from "../../../../lib/clinicAuth";
import { isValidMediaSignature } from "../../../../lib/mediaSignature";
import { readPostMedia } from "../../../../services/mediaStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "No se encontró el archivo de ese post.",
      },
    },
    { status: 404 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const authorized = isClinicAuthorized(request.headers.get("authorization")) ||
    isValidMediaSignature(id, url.searchParams.get("expires"), url.searchParams.get("signature"));
  if (!authorized) return new Response("Autenticación requerida.", { status: 401 });

  if (!POST_ID.test(id)) {
    return notFound();
  }

  try {
    const post = await prisma.scheduledPost.findUnique({
      where: { id, clinicId: "pilot" },
      select: { id: true, mediaType: true },
    });

    if (!post) {
      return notFound();
    }

    const kind = post.mediaType === "VIDEO" ? "video" : "image";
    const jpeg = kind === "image" && url.searchParams.get("format") === "jpeg";
    const contentType = kind === "video" ? "video/mp4" : jpeg ? "image/jpeg" : "image/png";
    const original = await readPostMedia(id, kind);
    const bytes = jpeg
      ? await sharp(Buffer.from(original)).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      : original;
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (
      (error instanceof Error && error.name === "PrismaClientInitializationError") ||
      (error instanceof Error && error.name === "PrismaClientKnownRequestError")
    ) {
      return NextResponse.json(
        {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "No se pudo consultar el archivo del post.",
          },
        },
        { status: 503 },
      );
    }

    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn("Archivo multimedia ausente para el post:", id);
      return NextResponse.json(
        { error: { code: "MEDIA_FILE_MISSING", message: "El archivo no existe en el almacenamiento configurado." } },
        { status: 404 },
      );
    }

    console.error("Error al leer el archivo multimedia del post:", id, error);
    return NextResponse.json(
      { error: { code: "MEDIA_READ_FAILED", message: "No se pudo leer el archivo guardado." } },
      { status: 503 },
    );
  }
}
