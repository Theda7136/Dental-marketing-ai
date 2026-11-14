"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TikTokPublisher } from "./TikTokPublisher";
import { MultinetworkPublisher } from "./MultinetworkPublisher";
import type { PublishNetwork } from "@/app/dashboard/actions";

export const POST_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "PUBLISHED",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

/** Post tal como lo devuelve Prisma, con fechas serializables hacia el cliente. */
export interface ApprovalQueuePost {
  id: string;
  procedureName: string;
  mediaUrl: string;
  generatedCaption: string;
  educationalCaption?: string | null;
  commercialCaption?: string | null;
  selectedStyle?: string;
  visualSummary?: string | null;
  status: PostStatus;
  facebookStatus?: string;
  facebookRetryCount?: number;
  instagramRetryCount?: number;
  instagramStatus?: string;
  facebookError?: string | null;
  instagramError?: string | null;
  canRecoverRejectedStory?: boolean;
  facebookPostId?: string | null;
  instagramPostId?: string | null;
  tiktokStatus?: string;
  tiktokPublishId?: string | null;
  tiktokError?: string | null;
  facebookReviewOutcome?: string | null;
  facebookReviewEvidence?: string | null;
  facebookReviewedAt?: string | null;
  instagramReviewOutcome?: string | null;
  instagramReviewEvidence?: string | null;
  instagramReviewedAt?: string | null;
  createdAt: Date | string;
  approvedAt?: Date | string | null;
  clinicalVerifiedAt?: string | null;
  scheduledFor?: string | null;
  /** Foto, video o guion. Si no viene, se infiere por la URL. */
  mediaKind?: "image" | "video" | "text";
  deliveryFormat?: "FEED" | "REEL" | "STORY";
}

interface ApprovalQueueProps {
  role?: string | null;
  onConfirmReview?: (postId: string) => Promise<void>;
  onReject?: (postId: string) => Promise<void>;
  onRecoverStory?: (postId: string) => Promise<void>;
  mode?: "pending" | "history" | "both";
  posts: readonly ApprovalQueuePost[];
  onPublishSelected: (postId: string, networks: PublishNetwork[], tiktok?: {
    privacy: string;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
  }) => Promise<{ ok: boolean; message: string; results: { network: PublishNetwork; outcome: "confirmed" | "processing" | "uncertain" | "not_sent"; message: string }[] }>;
  onReload: () => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
  onEdit: (post: ApprovalQueuePost, caption: string) => Promise<void>;
  onRetry: (postId: string, network: "facebook" | "instagram") => Promise<void>;
  onVerify: (postId: string, network: "facebook" | "instagram", outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN", evidence: string) => Promise<void>;
  onLookup: (postId: string, network: "facebook" | "instagram") => Promise<{ ok: boolean; message: string }>;
  onChooseStyle: (postId: string, style: "EDUCATIONAL" | "COMMERCIAL") => Promise<void>;
  onAuthorizeRetry: (postId: string, network: "facebook" | "instagram") => Promise<void>;
}

function historyNetworks(post: ApprovalQueuePost) {
  return [
    { name: "Facebook", status: post.facebookStatus ?? "PENDING" },
    { name: "Instagram", status: post.instagramStatus ?? "PENDING" },
    ...(post.deliveryFormat === "STORY" ? [] : [{ name: "TikTok", status: post.tiktokStatus ?? "PENDING" }]),
  ];
}

function publishingSummary(post: ApprovalQueuePost): string {
  if (post.status === "REJECTED") return "Propuesta descartada";
  const networks = historyNetworks(post);
  if (networks.some(({ status }) => status === "UNKNOWN" || status === "IN_PROGRESS" || status === "PROCESSING")) {
    return "Envío en curso";
  }
  const confirmed = networks.filter(({ status }) => status === "SUCCEEDED").length;
  if (confirmed === networks.length) return "Envíos confirmados";
  if (confirmed > 0) return "Publicación parcial";
  return "Sin confirmaciones de envío";
}

function matchesHistoryStatus(post: ApprovalQueuePost, status: string): boolean {
  const networks = historyNetworks(post).map(({ status: networkStatus }) => networkStatus);
  const hasUncertain = networks.some((value) => ["UNKNOWN", "IN_PROGRESS", "PROCESSING"].includes(value));
  const confirmed = networks.filter((value) => value === "SUCCEEDED").length;

  switch (status) {
    case "confirmed": return confirmed === networks.length;
    case "partial": return confirmed > 0 && confirmed < networks.length;
    case "review": return hasUncertain;
    case "pending": return networks.some((value) => value === "PENDING");
    case "rejected": return post.status === "REJECTED";
    default: return true;
  }
}

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible";
  }
  return dateFormatter.format(date);
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function mediaSource(post: ApprovalQueuePost): string {
  if (!post.mediaUrl) return "";
  const ownMediaPath = `/api/media/${post.id}`;
  try {
    const parsed = new URL(post.mediaUrl, "http://localhost");
    if (parsed.pathname === ownMediaPath) return ownMediaPath;
  } catch {
    return post.mediaUrl;
  }
  return post.mediaUrl;
}

export function ApprovalQueue({
  posts,
  role,
  onConfirmReview,
  onReject,
  mode = "both",
  onPublishSelected,
  onReload,
  onDelete,
  onEdit,
  onChooseStyle,
}: ApprovalQueueProps) {
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "EDITOR";
  const canPublish = role === "OWNER" || role === "ADMIN";
  const canReview = role === "OWNER" || role === "ADMIN" || role === "REVIEWER";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [expandedPosts, setExpandedPosts] = useState<string[]>([]);
  const [showPublished, setShowPublished] = useState(mode === "history");
  const [historyNetwork, setHistoryNetwork] = useState<"all" | "facebook" | "instagram" | "tiktok">("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const [pendingQuery, setPendingQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [pendingPage, setPendingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<ApprovalQueuePost | null>(null);
  const focusedOnce = useRef(false);
  const pageSize = 10;

  const reviewedPosts = useMemo(
    () => posts.filter((post) => post.status !== "PENDING_APPROVAL")
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [posts],
  );

  const filteredHistory = useMemo(() => reviewedPosts.filter((post) => {
    if (historyNetwork === "facebook" && (post.facebookStatus ?? "PENDING") === "PENDING") return false;
    if (historyNetwork === "instagram" && (post.instagramStatus ?? "PENDING") === "PENDING") return false;
    if (historyNetwork === "tiktok" && (post.deliveryFormat === "STORY" || (post.tiktokStatus ?? "PENDING") === "PENDING")) return false;
    return matchesHistoryStatus(post, historyStatus);
  }), [reviewedPosts, historyNetwork, historyStatus]);

  const pendingPosts = useMemo(
    () =>
      posts
        .filter((post) => post.status === "PENDING_APPROVAL")
        .slice()
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
    [posts],
  );

  const pendingMatches = useMemo(() =>
    pendingPosts.filter((post) =>
      post.procedureName.toLocaleLowerCase("es").includes(pendingQuery.trim().toLocaleLowerCase("es")),
    ),
    [pendingPosts, pendingQuery],
  );
  const historyMatches = useMemo(() =>
    filteredHistory.filter((post) => post.procedureName.toLocaleLowerCase("es").includes(historyQuery.trim().toLocaleLowerCase("es"))),
    [filteredHistory, historyQuery],
  );
  const pendingPages = Math.max(1, Math.ceil(pendingMatches.length / pageSize));
  const historyPages = Math.max(1, Math.ceil(historyMatches.length / pageSize));
  const pendingVisible = pendingMatches.slice((Math.min(pendingPage, pendingPages) - 1) * pageSize, Math.min(pendingPage, pendingPages) * pageSize);
  const historyVisible = historyMatches.slice((Math.min(historyPage, historyPages) - 1) * pageSize, Math.min(historyPage, historyPages) * pageSize);

  useEffect(() => {
    if (focusedOnce.current || posts.length === 0) return;

    const requestedId = new URLSearchParams(window.location.search).get("post");
    if (!requestedId) {
      focusedOnce.current = true;
      return;
    }

    const matchingPost = posts.find((post) => post.id === requestedId);
    if (!matchingPost) return;

    focusedOnce.current = true;
    setFocusedPostId(requestedId);
    if (matchingPost.status === "PENDING_APPROVAL") {
      setPendingQuery("");
      const index = pendingPosts.findIndex((post) => post.id === requestedId);
      setPendingPage(Math.floor(index / pageSize) + 1);
    } else {
      setShowPublished(true);
      setHistoryQuery("");
      setHistoryNetwork("all");
      setHistoryStatus("all");
      const index = reviewedPosts.findIndex((post) => post.id === requestedId);
      setHistoryPage(Math.floor(index / pageSize) + 1);
    }
  }, [posts, pendingPosts, reviewedPosts]);

  useEffect(() => {
    if (!focusedPostId) return;
    if (![...pendingVisible, ...historyVisible].some((post) => post.id === focusedPostId)) return;

    const frame = requestAnimationFrame(() => {
      document.getElementById(`proposal-${focusedPostId}`)?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedPostId, pendingPage, historyPage, mode, posts]);

  useEffect(() => {
    if (!previewPost) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewPost(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [previewPost]);

  function pageNav(page: number, pages: number, setPage: (page: number) => void) {
    if (pages <= 1) return null;
    return <nav aria-label="Paginación" className="mt-4 flex items-center justify-end gap-3 text-sm text-[#46615b]">
      <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={page <= 1}
        onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={page >= pages}
        onClick={() => setPage(page + 1)}>Siguiente</button>
    </nav>;
  }

  function deleteButton(post: ApprovalQueuePost) {
    if (!canWrite) return null;

    return (
      <button
        type="button"
        disabled={busyId === post.id}
        title="Retirar del panel sin borrar las publicaciones realizadas en redes."
        onClick={() => {
          if (!window.confirm(
            `¿Quitar «${post.procedureName}» del panel? No se borrará de Facebook, Instagram ni TikTok.`
          )) return;
          void runAction(post.id, onDelete);
        }}
        className="rounded-lg border border-[#d9e2dc] bg-white px-4 py-2.5 text-sm font-medium text-[#526762] transition hover:bg-[#f6faf7] disabled:opacity-50"
      >
        Quitar del panel
      </button>
    );
  }

  async function runAction(
    postId: string,
    action: (postId: string) => void | Promise<void>,
  ) {
    setBusyId(postId);
    setErrors((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });

    try {
      await action(postId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar la acción.";
      setErrors((current) => ({ ...current, [postId]: message }));
    } finally {
      setBusyId((current) => (current === postId ? null : current));
    }
  }

  return (
    <section aria-labelledby="approval-queue-title" className="w-full min-w-0">
      {mode !== "history" && <>
      <label className="mb-4 flex max-w-md flex-col gap-1 text-sm font-medium text-[#46615b]">Buscar procedimiento
        <input type="search" value={pendingQuery} onChange={(event) => { setPendingQuery(event.target.value); setPendingPage(1); }}
          placeholder="Ej. Implantes Dentales" className="min-h-11 rounded-lg border border-[#cadbd1] bg-white px-3" />
      </label>
      {pendingMatches.length === 0 ? (
        <div className="app-card flex min-h-64 flex-col items-center justify-center rounded-3xl border-dashed px-6 py-10 text-center">
          <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#edf5f1] text-[#398e82]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" stroke="currentColor" strokeWidth="1.6"><path d="M7 3.75h7l4 4V20a.75.75 0 0 1-.75.75h-10.5A.75.75 0 0 1 6 20V4.5a.75.75 0 0 1 1-.75Z" strokeLinejoin="round"/><path d="M14 4v4h4M9 13h6M9 16.5h6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <h3 className="text-base font-semibold text-[#29433f]">{pendingPosts.length === 0 ? "Todavía no hay propuestas" : "No hay coincidencias"}</h3>
          <p className="mt-1 max-w-xs text-sm leading-6 text-[#778984]">
            {pendingPosts.length === 0 ? "Las nuevas propuestas aparecerán aquí para que puedas revisarlas con calma." : "Prueba con otro procedimiento."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {pendingVisible.map((post) => {
            const isBusy = busyId === post.id;
            const isTextIdea = post.mediaKind === "text" || post.mediaUrl.length === 0;
            const isVideo = post.mediaKind === "video" || isVideoUrl(post.mediaUrl);
            const error = errors[post.id];
            const mediaError = mediaErrors[post.id];

            return (
              <li
                key={post.id}
                id={`proposal-${post.id}`}
                className={`app-card studio-proposal overflow-hidden ${focusedPostId === post.id ? "ring-2 ring-[#64a58d] ring-offset-2" : ""}`}
              >
                <article className="studio-proposal-grid grid gap-0">
                  <div className="studio-proposal-media relative overflow-hidden">
                    {isTextIdea ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm font-semibold text-[#356e66]">
                        Idea de contenido
                      </div>
                    ) : mediaError ? (
                      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[#815443]">
                        <strong>Archivo no disponible</strong>
                        <span>{mediaError}</span>
                      </div>
                    ) : isVideo ? (
                      <button
                        type="button"
                        onClick={() => setPreviewPost(post)}
                        aria-label={`Reproducir video de ${post.procedureName} en vista ampliada`}
                        title="Reproducir video ampliado"
                        className="studio-proposal-video-thumb group relative block overflow-hidden rounded-xl bg-[#101918] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c6d60]"
                      >
                        <video
                          className="pointer-events-none h-full w-full object-contain"
                          src={mediaSource(post)}
                          muted
                          playsInline
                          preload="metadata"
                          aria-hidden="true"
                          onError={() => setMediaErrors((previous) => ({ ...previous, [post.id]: "No se pudo cargar el video guardado." }))}
                        />
                        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover:bg-black/20">
                          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#123e36]/85 text-white shadow-lg">
                            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 translate-x-px">
                              <path d="m8 5 12 7-12 7V5Z" />
                            </svg>
                          </span>
                        </span>
                      </button>
                    ) : (
                      <img
                        className="studio-proposal-media-content"
                        src={mediaSource(post)}
                        alt={`Caso de ${post.procedureName}`}
                        onError={() => {
                          void fetch(mediaSource(post), { cache: "no-store" })
                            .then(async (response) => {
                              const detail = response.status === 401 ? "Se requiere iniciar sesión nuevamente."
                                : response.status === 404 ? "El archivo no está en el almacenamiento local."
                                : response.status === 503 ? "El servidor de archivos no está disponible."
                                : `Error HTTP ${response.status} al cargar la imagen.`;
                              setMediaErrors((previous) => ({ ...previous, [post.id]: detail }));
                              await response.body?.cancel();
                            })
                            .catch(() => setMediaErrors((previous) => ({ ...previous, [post.id]: "Comprueba que el servidor esté disponible." })));
                        }}
                      />
                    )}
                  </div>
                  <div className="studio-proposal-body flex min-w-0 flex-col gap-3 p-4 sm:p-5">
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-[#173b3a]">
                        {post.procedureName}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-[#8a9994]">
                        Creado el {formatCreatedAt(post.createdAt)}
                        {post.scheduledFor && <span className="ml-2 font-semibold text-[#176c63]">· Planificado: {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(post.scheduledFor))}</span>}
                      </p>
                    </div>

                    {canWrite && (post.educationalCaption || post.commercialCaption) && (
                      <div className="flex flex-wrap items-center gap-2" aria-label="Elegir estilo de copy">
                        {(["EDUCATIONAL", "COMMERCIAL"] as const).map((style) => {
                          const available = style === "EDUCATIONAL" ? post.educationalCaption : post.commercialCaption;
                          const chosen = (post.selectedStyle || "EDUCATIONAL") === style;
                          return (
                            <button
                              key={style}
                              type="button"
                              aria-pressed={chosen}
                              disabled={isBusy || !available || editingId === post.id ||
                                post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING" || (post.tiktokStatus ?? "PENDING") !== "PENDING"}
                              onClick={() => void runAction(post.id, () => onChooseStyle(post.id, style))}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                                chosen
                                  ? "border-[#176c63] bg-[#176c63] text-white"
                                  : "border-[#cbdcd4] bg-white text-[#176c63] hover:bg-[#edf5f1]"
                              }`}
                            >
                              {style === "EDUCATIONAL" ? "Educativa" : "Comercial"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {editingId === post.id ? (
                      <form
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!draftCaption.trim()) return;
                          void (async () => {
                            setBusyId(post.id);
                            try {
                              await onEdit(post, draftCaption);
                              setEditingId(null);
                            } catch (error) {
                              setErrors((current) => ({
                                ...current,
                                [post.id]: error instanceof Error ? error.message : "No se pudo guardar el texto.",
                              }));
                            } finally {
                              setBusyId(null);
                            }
                          })();
                        }}
                      >
                        <label htmlFor={`caption-${post.id}`} className="text-sm font-semibold text-[#173b3a]">
                          Texto de la publicación
                        </label>
                        <textarea
                          id={`caption-${post.id}`}
                          value={draftCaption}
                          maxLength={2200}
                          required
                          rows={7}
                          disabled={isBusy}
                          onChange={(event) => setDraftCaption(event.target.value)}
                          className="w-full rounded-xl border border-[#cddbd4] bg-white p-3 text-sm leading-6 text-[#29433f] focus:outline-2 focus:outline-offset-2 focus:outline-[#176c63]"
                        />
                        <p className="text-xs text-[#72847d]">{draftCaption.length} / 2200 caracteres</p>
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" disabled={isBusy || !draftCaption.trim()} className="rounded-xl bg-[#176c63] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                            {isBusy ? "Guardando..." : "Guardar cambios"}
                          </button>
                          <button type="button" disabled={isBusy} onClick={() => setEditingId(null)} className="rounded-xl border border-[#cddbd4] px-4 py-2 text-sm text-[#46615b]">
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div>
                        {post.generatedCaption && <p className={expandedPosts.includes(post.id)
                          ? "whitespace-pre-wrap text-sm leading-6 text-[#526762]"
                          : "line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#526762]"}>
                          {post.generatedCaption}
                        </p>}
                        {post.generatedCaption.length > 170 && (
                          <button
                            type="button"
                            aria-expanded={expandedPosts.includes(post.id)}
                            onClick={() => setExpandedPosts((current) =>
                              current.includes(post.id)
                                ? current.filter((id) => id !== post.id)
                                : [...current, post.id],
                            )}
                            className="mt-2 text-sm font-semibold text-[#176c63] underline-offset-4 hover:underline"
                          >
                            {expandedPosts.includes(post.id) ? "Ver menos" : "Leer texto completo"}
                          </button>
                        )}
                      </div>
                    )}

                {(post.facebookPostId || post.instagramPostId) && (
                  <div className="mt-3 space-y-1 break-all font-mono text-xs text-[#657873]">
                    {post.facebookPostId && <p>Facebook · ID: {post.facebookPostId}</p>}
                    {post.instagramPostId && <p>Instagram · ID: {post.instagramPostId}</p>}
                  </div>
                )}
                {error ? (
                      <p role="alert" className="text-sm text-red-700">
                        {error}
                      </p>
                    ) : null}

                    <div className="studio-proposal-actions mt-auto flex flex-wrap items-center gap-2">
                      {canPublish && <MultinetworkPublisher post={post} onPublish={onPublishSelected} onReload={onReload} />}
                      {canPublish && post.tiktokStatus === "PROCESSING" && <TikTokPublisher postId={post.id} mediaKind={post.mediaKind} status={post.tiktokStatus} />}
                      {canReview && onConfirmReview && !post.clinicalVerifiedAt && <button type="button" disabled={isBusy}
                        onClick={() => void runAction(post.id, onConfirmReview)}
                        className="rounded-lg border border-teal-700 px-4 py-2.5 text-sm font-semibold text-teal-800">Aprobar revisión clínica</button>}
                      {canWrite && !post.scheduledFor && post.facebookStatus === "PENDING" &&
                        post.instagramStatus === "PENDING" && (post.tiktokStatus ?? "PENDING") === "PENDING" &&
                        <a href={`/dashboard/calendario?post=${encodeURIComponent(post.id)}`}
                          className="rounded-lg border border-[#d9e2dc] bg-white px-4 py-2.5 text-sm font-semibold text-[#46615b] hover:bg-[#f6faf7]">
                          Planificar
                        </a>}
                      {canReview && onReject && post.facebookStatus === "PENDING" &&
                        post.instagramStatus === "PENDING" && (post.tiktokStatus ?? "PENDING") === "PENDING" &&
                        !post.facebookPostId && !post.instagramPostId && !post.tiktokPublishId &&
                        (post.facebookRetryCount ?? 0) === 0 && (post.instagramRetryCount ?? 0) === 0 &&
                        <button type="button" disabled={isBusy}
                          onClick={() => {
                            if (!window.confirm("¿Descartar esta propuesta? No se enviará a redes sociales.")) return;
                            void runAction(post.id, onReject);
                          }}
                          className="rounded-lg px-3 py-2.5 text-sm font-semibold text-[#8a5a51] hover:bg-[#fcf4f1] disabled:opacity-50">
                          Descartar
                        </button>}
                      {canWrite && post.deliveryFormat !== "STORY" && <button
                        type="button"
                        disabled={isBusy || (post.facebookStatus !== undefined && (post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING")) || (post.tiktokStatus ?? "PENDING") !== "PENDING"}
                        onClick={() => {
                          setErrors((current) => {
                            const next = { ...current };
                            delete next[post.id];
                            return next;
                          });
                          setDraftCaption(post.generatedCaption);
                          setEditingId(post.id);
                        }}
                        className="rounded-lg border border-[#d9e2dc] bg-white px-4 py-2.5 text-sm font-semibold text-[#46615b] transition hover:border-[#a8c6bb] hover:bg-[#f6faf7] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Editar texto
                      </button>}
                      {deleteButton(post)}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {pageNav(Math.min(pendingPage, pendingPages), pendingPages, setPendingPage)}

      </>}
      {mode !== "pending" && <section className="studio-history-section" aria-labelledby="published-history-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="published-history-title" className="text-lg font-semibold text-[#173b3a]">Historial de publicaciones</h3>
            <p className="mt-1 text-sm text-[#637773]">{reviewedPosts.length} {reviewedPosts.length === 1 ? "propuesta registrada" : "propuestas registradas"} en el historial.</p>
          </div>
          {mode === "both" && <button
            type="button"
            aria-expanded={showPublished}
            onClick={() => setShowPublished((current) => !current)}
            className="rounded-xl border border-[#d7e5df] bg-white px-4 py-2 text-sm font-medium text-[#176c63]"
          >
            {showPublished ? "Ocultar historial" : "Ver historial"}
          </button>}
        </div>
        {(mode === "history" || showPublished) && (
          <>
            <div className="mt-4 grid gap-3 rounded-xl bg-[#f2f7f4] p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#46615b]">
                Plataforma
                <select
                  value={historyNetwork}
                  onChange={(event) => setHistoryNetwork(event.target.value as "all" | "facebook" | "instagram" | "tiktok")}
                  className="min-h-10 rounded-lg border border-[#d1dfd6] bg-white px-3 text-sm"
                >
                  <option value="all">Todas las plataformas</option>
                  <option value="facebook">Con actividad en Facebook</option>
                  <option value="instagram">Con actividad en Instagram</option>
                  <option value="tiktok">Con actividad en TikTok</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#46615b]">
                Estado
                <select
                  value={historyStatus}
                  onChange={(event) => setHistoryStatus(event.target.value)}
                  className="min-h-10 rounded-lg border border-[#d1dfd6] bg-white px-3 text-sm"
                >
                  <option value="all">Todos los estados</option>
                  <option value="confirmed">Todas las redes confirmadas</option>
                  <option value="partial">Publicación parcial</option>
                  <option value="pending">Con redes sin enviar</option>
                  <option value="rejected">Propuesta descartada</option>
                </select>
              </label>
            </div>
            <label className="mt-3 flex max-w-md flex-col gap-1 text-sm font-medium text-[#46615b]">Buscar procedimiento
              <input type="search" value={historyQuery} onChange={(event) => { setHistoryQuery(event.target.value); setHistoryPage(1); }}
                placeholder="Ej. Ortodoncia" className="min-h-11 rounded-lg border border-[#cadbd1] bg-white px-3" />
            </label>
            <p role="status" className="mt-3 text-xs text-[#637773]">{historyMatches.length} de {reviewedPosts.length} registros</p>
            <ul className="mt-3 space-y-3">
            {historyMatches.length ? historyVisible.map((post) => (
              <li key={post.id} id={`proposal-${post.id}`} className={`rounded-2xl border border-[#d7e5df] bg-white p-4 ${focusedPostId === post.id ? "ring-2 ring-[#64a58d] ring-offset-2" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#173b3a]">{post.procedureName} {post.deliveryFormat === "REEL" ? "· Reel" : post.deliveryFormat === "STORY" ? "· Historia" : ""}</p>
                    <p className="mt-1 text-xs text-[#82928e]">{formatCreatedAt(post.createdAt)} · {publishingSummary(post)}</p>
                  </div>
                  {historyNetworks(post).some(({ status }) => status === "SUCCEEDED") && (
                    <p className="text-xs font-medium text-[#176c63]">
                      Publicada en {historyNetworks(post).filter(({ status }) => status === "SUCCEEDED").map(({ name }) => name).join(", ")}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {canPublish && <MultinetworkPublisher post={post} onPublish={onPublishSelected} onReload={onReload} />}
                  {canPublish && post.tiktokStatus === "PROCESSING" && <TikTokPublisher postId={post.id} mediaKind={post.mediaKind} status={post.tiktokStatus} />}
                  {deleteButton(post)}
                </div>
              </li>
            )) : <li className="text-sm text-[#637773]">No hay registros que coincidan con los filtros.</li>}
          </ul>
          {pageNav(Math.min(historyPage, historyPages), historyPages, setHistoryPage)}
          </>
        )}
      </section>}
      {previewPost && (
        <div
          role="presentation"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#081c19]/85 p-3 sm:p-6"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewPost(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Vista ampliada de ${previewPost.procedureName}`}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#dce7e0] px-4 py-3">
              <p className="truncate text-sm font-semibold text-[#183d37]">{previewPost.procedureName} · Vista del video final</p>
              <button type="button" autoFocus onClick={() => setPreviewPost(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[#176c63] hover:bg-[#eef6f2]">
                Cerrar
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[#101918] p-3">
              <video key={previewPost.id} src={mediaSource(previewPost)} controls autoPlay playsInline
                className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain"
                aria-label={`Reproducción ampliada de ${previewPost.procedureName}`} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
