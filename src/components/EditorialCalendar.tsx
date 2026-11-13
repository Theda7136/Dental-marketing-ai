"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApprovalQueuePost } from "@/components/ApprovalQueue";

const BOGOTA_TIME_ZONE = "America/Bogota";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const IDEAS = [
  { category: "Educación", topic: "Mitos y realidades sobre la salud oral", format: "Carrusel o Reel" },
  { category: "Prevención", topic: "Tres hábitos que protegen tus encías", format: "Reel" },
  { category: "Confianza", topic: "Presentación del equipo y su experiencia", format: "Historia" },
  { category: "Servicio", topic: "¿Qué sucede durante una valoración odontológica?", format: "Publicación" },
  { category: "Educación", topic: "Cómo cuidar una restauración dental", format: "Reel" },
  { category: "Comunidad", topic: "Responde una pregunta frecuente de pacientes", format: "Historia" },
];

function bogotaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, index) => `${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`),
  ];
}

function postLabel(post: ApprovalQueuePost): string {
  const format = post.deliveryFormat === "REEL" ? "Reel" : post.deliveryFormat === "STORY" ? "Historia" : "Feed";
  return `${post.procedureName} · ${format}`;
}

export function EditorialCalendar({ posts, onReload }: {
  posts: readonly ApprovalQueuePost[];
  onReload: () => Promise<void>;
}) {
  const today = bogotaDate(new Date());
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [clockTime, setClockTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const available = posts.filter((post) => post.status === "PENDING_APPROVAL" &&
    !post.scheduledFor &&
    (post.facebookStatus ?? "PENDING") === "PENDING" &&
    (post.instagramStatus ?? "PENDING") === "PENDING" &&
    (post.tiktokStatus ?? "PENDING") === "PENDING" &&
    (post.facebookRetryCount ?? 0) === 0 &&
    (post.instagramRetryCount ?? 0) === 0);
  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get("post");
    if (!requestedId) return;
    const proposal = posts.find((post) => post.id === requestedId);
    if (proposal && !proposal.scheduledFor && proposal.status === "PENDING_APPROVAL" &&
      proposal.facebookStatus === "PENDING" && proposal.instagramStatus === "PENDING" &&
      (proposal.tiktokStatus ?? "PENDING") === "PENDING" &&
      (proposal.facebookRetryCount ?? 0) === 0 && (proposal.instagramRetryCount ?? 0) === 0) {
      setSelectedPostId(requestedId);
    }
  }, [posts]);

  const scheduled = posts.filter((post) => Boolean(post.scheduledFor) && post.status !== "REJECTED");
  const overdue = scheduled.filter((post) =>
    post.status === "PENDING_APPROVAL" && new Date(post.scheduledFor!).getTime() < Date.now(),
  );
  const grouped = useMemo(() => {
    const byDay = new Map<string, ApprovalQueuePost[]>();
    for (const post of scheduled) {
      const date = bogotaDate(new Date(post.scheduledFor!));
      byDay.set(date, [...(byDay.get(date) ?? []), post]);
    }
    for (const proposals of byDay.values()) {
      proposals.sort((left, right) => new Date(left.scheduledFor!).getTime() - new Date(right.scheduledFor!).getTime());
    }
    return byDay;
  }, [posts]);

  const cells = monthCells(year, month);
  const dayPosts = grouped.get(selectedDay) ?? [];
  const overdueIds = new Set(overdue.map((post) => post.id));
  const activeDays = cells.filter((day): day is string => Boolean(day));
  const plannedDays = activeDays.filter((day) => grouped.has(day)).length;
  const ideaOffset = (year + month) % IDEAS.length;
  const ideas = [...IDEAS.slice(ideaOffset), ...IDEAS.slice(0, ideaOffset)].slice(0, 3);

  function changeMonth(offset: number) {
    const date = new Date(Date.UTC(year, month + offset, 1));
    setYear(date.getUTCFullYear());
    setMonth(date.getUTCMonth());
    setSelectedDay(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`);
    setMessage(null);
  }

  async function saveSchedule(postId: string, dateTime: string | null) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledFor: dateTime }),
      });
      const responseBody = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !responseBody.ok) throw new Error(responseBody.message || "No se pudo guardar la fecha.");
      await onReload();
      setSelectedPostId("");
      setMessage(dateTime ? "Fecha guardada. La propuesta sigue pendiente de revisión y la publicación no es automática." : "Fecha retirada del calendario.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la planificación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5" aria-label="Calendario editorial">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.13em] text-[#6e9687]">Planificación editorial</p>
          <h2 className="mt-1 text-xl font-semibold text-[#183d37]">Calendario de contenido</h2>
          <p className="mt-1 text-sm text-[#667d72]">Organiza tus propuestas con la hora de Colombia. Los envíos siguen siendo manuales desde Pendientes.</p>
        </div>
        <a href="/dashboard/crear" className="rounded-xl bg-[#176c63] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0e554d]">+ Nueva propuesta</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Propuestas planificadas", value: scheduled.length },
          { label: "Pendientes por ubicar", value: available.length },
          { label: "Planificaciones vencidas", value: overdue.length },
        ].map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-[#dce7e0] bg-white p-4">
            <p className="text-xs text-[#6e8179]">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[#18483f]">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <div className="rounded-2xl border border-[#dce7e0] bg-white p-3 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="Mes anterior" className="rounded-lg border border-[#d5e5db] px-3 py-2 text-[#176c63]">‹</button>
            <h3 className="text-base font-semibold capitalize text-[#183d37]">{MONTHS[month]} {year}</h3>
            <button type="button" onClick={() => changeMonth(1)} aria-label="Mes siguiente" className="rounded-lg border border-[#d5e5db] px-3 py-2 text-[#176c63]">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => <span key={day} className="py-2 text-center text-xs font-medium text-[#738880]">{day}</span>)}
            {cells.map((day, index) => day ? (
              <button key={day} type="button" aria-pressed={day === selectedDay} onClick={() => setSelectedDay(day)}
                className={`flex min-h-16 flex-col items-start gap-1 rounded-lg border p-2 text-left transition sm:min-h-20 ${day === selectedDay ? "border-[#72a996] bg-[#edf7f1]" : "border-transparent hover:border-[#dbe8e0] hover:bg-[#f7faf8]"}`}>
                <span className={`text-xs font-semibold ${day === today ? "rounded-full bg-[#176c63] px-1.5 py-0.5 text-white" : "text-[#36584d]"}`}>{Number(day.slice(-2))}</span>
                {(grouped.get(day) ?? []).slice(0, 2).map((post) =>
                  <span key={post.id}
                    className={`w-full truncate rounded px-1 py-0.5 text-[10px] ${overdueIds.has(post.id) ? "bg-amber-100 text-amber-900" : post.status === "PUBLISHED" ? "bg-[#e2f0e9] text-[#176c63]" : "bg-[#edf1f6] text-[#435b70]"}`}
                    title={`${postLabel(post)} · ${overdueIds.has(post.id) ? "Planificación vencida" : post.status === "PUBLISHED" ? "Publicada" : "Pendiente"}`}>
                    {post.procedureName}
                  </span>)}

                {(grouped.get(day)?.length ?? 0) > 2 && <small className="text-[10px] text-[#577669]">+{grouped.get(day)!.length - 2}</small>}
              </button>
            ) : <span key={`pad-${index}`} aria-hidden="true" />)}
          </div>
          <p className="mt-3 text-xs text-[#70857b]">{plannedDays} días con contenido planificado · Hora de Colombia</p>
          {overdue.length > 0 && <p className="mt-2 text-xs text-amber-800" role="status">
            {overdue.length} propuesta(s) con fecha vencida siguen pendientes. Puedes revisar su estado en Pendientes.
          </p>}
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-[#dce7e0] bg-white p-4">
            <h3 className="text-base font-semibold text-[#183d37]">Planificar · {selectedDay}</h3>
            <p className="mt-1 text-xs text-[#6e8179]">Elige una propuesta pendiente y una hora.</p>
            <label className="mt-4 block text-xs font-medium text-[#587266]" htmlFor="calendar-proposal">Propuesta</label>
            <select id="calendar-proposal" value={selectedPostId} onChange={(event) => setSelectedPostId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#cbded4] bg-white p-2.5 text-sm text-[#183d37]">
              <option value="">Selecciona una propuesta</option>
              {available.map((post) => <option key={post.id} value={post.id}>{postLabel(post)}</option>)}
            </select>
            <label className="mt-3 block text-xs font-medium text-[#587266]" htmlFor="calendar-time">Hora de Colombia</label>
            <input id="calendar-time" type="time" value={clockTime} onChange={(event) => setClockTime(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#cbded4] bg-white p-2.5 text-sm text-[#183d37]" />
            <button type="button" disabled={busy || !selectedPostId || !clockTime} onClick={() => void saveSchedule(selectedPostId, `${selectedDay}T${clockTime}`)}
              className="mt-3 w-full rounded-lg bg-[#176c63] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar en calendario</button>
            {message && <p role="status" className="mt-3 text-xs leading-5 text-[#376458]">{message}</p>}
            <div className="mt-4 border-t border-[#e3eee7] pt-3">
              <h4 className="text-sm font-semibold text-[#183d37]">Propuestas del día</h4>
              {dayPosts.length === 0 ? <p className="mt-2 text-sm text-[#809088]">Aún no hay contenido planificado.</p> :
                <ul className="mt-2 space-y-2">{dayPosts.map((post) => (
                  <li key={post.id} className="rounded-lg bg-[#f5f9f6] p-3">
                    <p className="text-sm font-medium text-[#21483b]">{postLabel(post)}</p>
                    <p className="mt-1 text-xs text-[#71887c]">{new Intl.DateTimeFormat("es-CO", { timeZone: BOGOTA_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(post.scheduledFor!))} · {overdueIds.has(post.id) ? "Planificación vencida" : post.status === "PENDING_APPROVAL" ? "Pendiente de revisión" : post.status === "PUBLISHED" ? "Publicada" : "Estado: " + post.status}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-4">
                      <a href={`/dashboard/${post.status === "PENDING_APPROVAL" ? "pendientes" : "historial"}?post=${encodeURIComponent(post.id)}`}
                        className="text-xs font-semibold text-[#176c63] hover:underline">
                        Ver propuesta
                      </a>
                      {post.status === "PENDING_APPROVAL" && <button type="button" disabled={busy} onClick={() => void saveSchedule(post.id, null)} className="text-xs font-semibold text-[#176c63] disabled:opacity-40">Quitar fecha</button>}
                    </div>
                  </li>
                ))}</ul>}
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-[#dce7e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[#183d37]">Ideas para completar el calendario</h3>
          <span className="text-xs text-[#70857b]">Sugerencias editoriales, no generadas con IA</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ideas.map((idea) => (
            <div key={idea.topic} className="rounded-xl border border-[#e0eae4] bg-[#f8faf8] p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#678c7d]">{idea.category} · {idea.format}</span>
              <p className="mt-2 text-sm font-semibold text-[#264b40]">{idea.topic}</p>
              <a href="/dashboard/crear" className="mt-3 inline-block text-xs font-semibold text-[#176c63]">Crear propuesta</a>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
