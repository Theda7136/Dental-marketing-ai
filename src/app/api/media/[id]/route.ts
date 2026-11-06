import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

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
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!POST_ID.test(id)) {
    return notFound();
  }

  try {
    const post = await prisma.scheduledPost.findUnique({
      where: { id },
      select: { id: true, mediaType: true },
    });

    if (!post) {
      return notFound();
    }

    const extension = post.mediaType === "VIDEO" ? "mp4" : "png";
    const contentType = post.mediaType === "VIDEO" ? "video/mp4" : "image/png";
    const storageDir = path.resolve(process.cwd(), "storage", "posts");
    const filePath = path.resolve(storageDir, `${id}.${extension}`);

    if (!filePath.startsWith(`${storageDir}${path.sep}`)) {
      return notFound();
    }

    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientKnownRequestError
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

    return notFound();
  }
}
