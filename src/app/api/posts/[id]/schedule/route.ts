import { NextResponse } from "next/server";
import { isClinicAuthorized, unauthorizedResponse } from "@/lib/clinicAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBogotaTime(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}:00-05:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const timeParts = Object.fromEntries(localDate.map((part) => [part.type, part.value]));
  if (`${timeParts.year}-${timeParts.month}-${timeParts.day}T${timeParts.hour}:${timeParts.minute}` !== value) return undefined;
  return date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isClinicAuthorized(request.headers.get("authorization"))) return unauthorizedResponse(true);
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return NextResponse.json({ message: "Identificador de propuesta no válido." }, { status: 400 });
  }

  let scheduledFor: Date | null | undefined;
  try {
    const body: unknown = await request.json();
    scheduledFor = parseBogotaTime((body as { scheduledFor?: unknown } | null)?.scheduledFor);
  } catch {
    return NextResponse.json({ message: "No se pudo leer la fecha programada." }, { status: 400 });
  }
  if (scheduledFor === undefined) {
    return NextResponse.json({ message: "Usa fecha y hora válidas en Colombia (AAAA-MM-DDTHH:mm), o null para quitarla." }, { status: 400 });
  }
  if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
    return NextResponse.json({ message: "Selecciona una fecha y hora futuras para la planificación." }, { status: 400 });
  }

  try {
    const updated = await prisma.scheduledPost.updateMany({
      where: {
        id, clinicId: "pilot", archivedAt: null, status: "PENDING_APPROVAL",
        facebookStatus: "PENDING", instagramStatus: "PENDING", tiktokStatus: "PENDING",
        facebookPostId: null, instagramPostId: null, tiktokPublishId: null,
        facebookRetryCount: 0, instagramRetryCount: 0,
      },
      data: { scheduledFor },
    });
    if (updated.count !== 1) {
      return NextResponse.json({
        message: "Solo puedes planificar propuestas pendientes sin envíos iniciados. Revisa su estado.",
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, scheduledFor: scheduledFor?.toISOString() ?? null });
  } catch (error) {
    console.error("No se pudo guardar la planificación:", error);
    return NextResponse.json({ message: "No se pudo actualizar el calendario." }, { status: 500 });
  }
}
