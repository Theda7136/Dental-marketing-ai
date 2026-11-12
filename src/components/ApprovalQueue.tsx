"use client";

import { useMemo, useState } from "react";
import { platformCaptions } from "@/lib/platformCopy.mjs";

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
  facebookPostId?: string | null;
  instagramPostId?: string | null;
  facebookReviewOutcome?: string | null;
  facebookReviewEvidence?: string | null;
  facebookReviewedAt?: string | null;
  instagramReviewOutcome?: string | null;
  instagramReviewEvidence?: string | null;
  instagramReviewedAt?: string | null;
  createdAt: Date | string;
  approvedAt?: Date | string | null;
  clinicalVerifiedAt?: string | null;
  /** Foto, video o guion. Si no viene, se infiere por la URL. */
  mediaKind?: "image" | "video" | "text";
}

interface ApprovalQueueProps {
  mode?: "pending" | "history" | "both";
  posts: readonly ApprovalQueuePost[];
  onApprove: (postId: string) => void | Promise<void>;
  onConfirmClinical: (postId: string) => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
  onEdit: (post: ApprovalQueuePost, caption: string) => Promise<void>;
  onRetry: (postId: string, network: "facebook" | "instagram") => Promise<void>;
  onVerify: (postId: string, network: "facebook" | "instagram", outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN", evidence: string) => Promise<void>;
  onLookup: (postId: string, network: "facebook" | "instagram") => Promise<{ ok: boolean; message: string }>;
  onChooseStyle: (postId: string, style: "EDUCATIONAL" | "COMMERCIAL") => Promise<void>;
  onAuthorizeRetry: (postId: string, network: "facebook" | "instagram") => Promise<void>;
}

const NETWORK_LABELS: Record<string, string> = {
  PENDING: "Sin enviar",
  IN_PROGRESS: "En proceso",
  SUCCEEDED: "Confirmado",
  UNKNOWN: "Por verificar",
};

function networkStatus(label: string, status?: string) {
  if (!status) return null;
  const isConfirmed = status === "SUCCEEDED";
  const needsReview = status === "UNKNOWN" || status === "IN_PROGRESS";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
      isConfirmed ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : needsReview ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-[#d7e5df] bg-[#f4f7f5] text-[#657873]"
    }`}>
      {label}: {NETWORK_LABELS[status] || status}
    </span>
  );
}

function publishingSummary(post: ApprovalQueuePost): string {
  if (post.status === "REJECTED") return "Propuesta descartada";
  if (post.status === "APPROVED") return "Aprobación registrada";

  const statuses = [post.facebookStatus, post.instagramStatus];
  if (statuses.some((status) => status === "UNKNOWN" || status === "IN_PROGRESS")) {
    return "Publicación con estado por verificar";
  }
  if (statuses.every((status) => status === "SUCCEEDED")) return "Confirmada en ambas redes";
  if (statuses.some((status) => status === "SUCCEEDED")) return "Confirmada parcialmente";
  return "Publicación sin confirmación por red";
}

function matchesHistoryStatus(post: ApprovalQueuePost, status: string): boolean {
  const networkStatuses = [post.facebookStatus, post.instagramStatus];
  switch (status) {
    case "confirmed":
      return networkStatuses.some((value) => value === "SUCCEEDED") &&
        !networkStatuses.some((value) => value === "UNKNOWN" || value === "IN_PROGRESS");
    case "partial":
      return networkStatuses.some((value) => value === "SUCCEEDED") &&
        networkStatuses.some((value) => value !== "SUCCEEDED");
    case "review":
      return networkStatuses.some((value) => value === "UNKNOWN" || value === "IN_PROGRESS");
    case "rejected":
      return post.status === "REJECTED";
    default:
      return true;
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
  mode = "both",
  onApprove,
  onConfirmClinical,
  onDelete,
  onEdit,
  onRetry,
  onVerify,
  onLookup,
  onChooseStyle,
  onAuthorizeRetry,
}: ApprovalQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [expandedPosts, setExpandedPosts] = useState<string[]>([]);
  const [showPublished, setShowPublished] = useState(mode === "history");
  const [historyNetwork, setHistoryNetwork] = useState<"all" | "facebook" | "instagram">("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<"FOUND" | "NOT_FOUND" | "UNCERTAIN">("UNCERTAIN");
  const [reviewEvidence, setReviewEvidence] = useState("");
  const [lookupMessages, setLookupMessages] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const [clinicalChecks, setClinicalChecks] = useState<Record<string, boolean>>({});
  const [platformPreview, setPlatformPreview] = useState<Record<string, "facebook" | "instagram">>({});
  const [pendingQuery, setPendingQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [pendingPage, setPendingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const pageSize = 10;

  const reviewedPosts = useMemo(
    () => posts.filter((post) => post.status !== "PENDING_APPROVAL")
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [posts],
  );

  const filteredHistory = useMemo(() => reviewedPosts.filter((post) => {
    if (historyNetwork === "facebook" && post.facebookStatus === "PENDING") return false;
    if (historyNetwork === "instagram" && post.instagramStatus === "PENDING") return false;
    return matchesHistoryStatus(post, historyStatus);
  }), [reviewedPosts, historyNetwork, historyStatus]);

  const pendingPosts = useMemo(
    () =>
      posts
        .filter((post) => post.status === "PENDING_APPROVAL")
        .slice()
        .sort(
          (left, right) =>
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        ),
    [posts],
  );

  const pendingMatches = useMemo(() =>
    pendingPosts.filter((post) => post.procedureName.toLocaleLowerCase("es").includes(pendingQuery.trim().toLocaleLowerCase("es"))),
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

  function verificationControl(post: ApprovalQueuePost, network: "facebook" | "instagram") {
    const status = network === "facebook" ? post.facebookStatus : post.instagramStatus;
    if (status !== "UNKNOWN" && status !== "IN_PROGRESS") return null;

    const key = `${post.id}:${network}`;
    const outcome = network === "facebook" ? post.facebookReviewOutcome : post.instagramReviewOutcome;
    const evidence = network === "facebook" ? post.facebookReviewEvidence : post.instagramReviewEvidence;
    const reviewedAt = network === "facebook" ? post.facebookReviewedAt : post.instagramReviewedAt;
    const label = network === "facebook" ? "Facebook" : "Instagram";

    return (
      <div key={key} className="mt-3 rounded-xl border border-[#e6d8b4] bg-[#fffbf1] p-3">
        <p className="text-sm font-semibold text-[#685335]">{label} · requiere comprobación</p>
        {outcome && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#685335]">
            Última revisión: {outcome === "FOUND" ? "Publicación encontrada" : outcome === "NOT_FOUND" ? "No encontrada" : "Sin conclusión"}
            {reviewedAt ? ` · ${formatCreatedAt(reviewedAt)}` : ""}
            {evidence ? ` · ${evidence}` : ""}
          </p>
        )}
        {status === "UNKNOWN" && outcome === "NOT_FOUND" && !(
          network === "facebook" ? post.facebookPostId : post.instagramPostId
        ) && (
          <button
            type="button"
            disabled={busyId === post.id}
            className="mt-2 rounded-lg bg-[#176c63] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() => {
              const confirmed = window.confirm(
                `¿Verificaste la cuenta y el historial de ${label}, y confirmas que esta publicación no existe? Habilitarás un único reintento manual. Una publicación demorada podría duplicarse.`,
              );
              if (!confirmed) return;
              void runAction(post.id, () => onAuthorizeRetry(post.id, network));
            }}
          >
            Habilitar un reintento tras comprobar Meta
          </button>
        )}
        {reviewKey === key ? (
          <form className="mt-3 space-y-2" onSubmit={(event) => {
            event.preventDefault();
            if (!reviewEvidence.trim()) return;
            void runAction(post.id, async () => {
              await onVerify(post.id, network, reviewOutcome, reviewEvidence);
              setReviewKey(null);
              setReviewEvidence("");
            });
          }}>
            <label className="block text-xs font-semibold text-[#685335]" htmlFor={`verification-${key}`}>Resultado observado en Meta</label>
            <select
              id={`verification-${key}`}
              value={reviewOutcome}
              disabled={busyId === post.id}
              onChange={(event) => setReviewOutcome(event.target.value as "FOUND" | "NOT_FOUND" | "UNCERTAIN")}
              className="w-full rounded-lg border border-[#d6c7a4] bg-white p-2 text-sm"
            >
              <option value="UNCERTAIN">No pude determinarlo</option>
              <option value="FOUND">Encontré la publicación</option>
              <option value="NOT_FOUND">No encontré la publicación</option>
            </select>
            <label className="block text-xs font-semibold text-[#685335]" htmlFor={`evidence-${key}`}>Cómo lo comprobaste (sin datos de pacientes)</label>
            <textarea
              id={`evidence-${key}`}
              required
              maxLength={1000}
              rows={3}
              disabled={busyId === post.id}
              value={reviewEvidence}
              onChange={(event) => setReviewEvidence(event.target.value)}
              placeholder="Fecha de la consulta, enlace público si existe o detalle de la revisión"
              className="w-full rounded-lg border border-[#d6c7a4] bg-white p-2 text-sm"
            />
            <p className="text-xs text-[#806b49]">Registrar una revisión no envía nada. Si no se encontró, podrás solicitar un reintento manual limitado.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busyId === post.id || !reviewEvidence.trim()} className="rounded-lg bg-[#69553a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Guardar verificación</button>
              <button type="button" disabled={busyId === post.id} onClick={() => setReviewKey(null)} className="rounded-lg border border-[#d6c7a4] px-3 py-2 text-xs">Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" className="mt-2 rounded-lg border border-[#d6c7a4] bg-white px-3 py-2 text-xs font-semibold text-[#685335]" onClick={() => {
            setReviewKey(key);
            setReviewOutcome(outcome === "FOUND" || outcome === "NOT_FOUND" ? outcome : "UNCERTAIN");
            setReviewEvidence(evidence || "");
          }}>Registrar comprobación</button>
        )}
      </div>
    );
  }

  function retryButton(post: ApprovalQueuePost, network: "facebook" | "instagram") {
    const retryAuthorized = (post.facebookRetryCount ?? 0) > 0 || (post.instagramRetryCount ?? 0) > 0;
    const authorizedNetwork = network === "facebook" ? (post.facebookRetryCount ?? 0) > 0 : (post.instagramRetryCount ?? 0) > 0;
    if ((retryAuthorized && !authorizedNetwork) || post.mediaUrl.length === 0 || post[network === "facebook" ? "facebookStatus" : "instagramStatus"] !== "PENDING") {
      return null;
    }

    return (
      <button
        type="button"
        disabled={busyId === post.id}
        onClick={() => {
          const platform = network === "facebook" ? "Facebook" : "Instagram";
          if (!window.confirm(`Publicar ahora únicamente en ${platform}? Comprueba que el material esté autorizado y la cuenta conectada.`)) return;
          void runAction(post.id, () => onRetry(post.id, network));
        }}
        className="rounded-xl border border-[#b7d7ce] bg-[#f2faf6] px-3 py-2 text-xs font-semibold text-[#176c63] disabled:opacity-50"
      >
        Publicar solo en {network === "facebook" ? "Facebook" : "Instagram"}
      </button>
    );
  }

  function deleteButton(post: ApprovalQueuePost) {
    const unresolved = ["UNKNOWN", "IN_PROGRESS"].includes(post.facebookStatus || "") ||
      ["UNKNOWN", "IN_PROGRESS"].includes(post.instagramStatus || "");
    const priorAttempt = post.status === "PENDING_APPROVAL" &&
      (post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING" ||
        Boolean(post.facebookRetryCount) || Boolean(post.instagramRetryCount) ||
        Boolean(post.facebookPostId) || Boolean(post.instagramPostId));

    return (
      <button
        type="button"
        disabled={busyId === post.id || unresolved || priorAttempt}
        title={unresolved || priorAttempt ? "Primero resuelve el estado de publicación en Meta." : "Ocultar de la lista conservando el registro interno."}
        onClick={() => {
          if (!window.confirm(
            `¿Eliminar «${post.procedureName}» de la lista? El registro se conservará y no se borrará de Facebook ni Instagram.`
          )) return;
          void runAction(post.id, onDelete);
        }}
        className="rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Eliminar
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
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div>
        <h2
          id="approval-queue-title"
          className="text-xl font-semibold tracking-tight text-[#173b3a] sm:text-2xl"
        >
          Pendientes de revisión
        </h2>
        <p className="mt-1 text-sm text-[#637773]">
          {pendingPosts.length === 0
            ? "Las nuevas propuestas aparecerán aquí."
            : `${pendingPosts.length} ${pendingPosts.length === 1 ? "propuesta lista" : "propuestas listas"} para revisar.`}
        </p>
          </div>
        </div>
        <span className="ml-12 inline-flex w-fit items-center rounded-full border border-[#d7e5df] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#55716b] sm:ml-0">
          {pendingPosts.length} {pendingPosts.length === 1 ? "pendiente" : "pendientes"}
        </span>
      </header>

      <label className="mb-4 flex max-w-md flex-col gap-1 text-sm font-medium text-[#46615b]">Buscar procedimiento
        <input type="search" value={pendingQuery} onChange={(event) => { setPendingQuery(event.target.value); setPendingPage(1); }}
          placeholder="Ej. Implantes Dentales" className="min-h-11 rounded-lg border border-[#cadbd1] bg-white px-3" />
      </label>
      {pendingMatches.length === 0 ? (
        <div className="app-card flex min-h-64 flex-col items-center justify-center rounded-3xl border-dashed px-6 py-10 text-center">
          <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#edf5f1] text-[#398e82]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" stroke="currentColor" strokeWidth="1.6"><path d="M7 3.75h7l4 4V20a.75.75 0 0 1-.75.75h-10.5A.75.75 0 0 1 6 20V4.5a.75.75 0 0 1 1-.75Z" strokeLinejoin="round"/><path d="M14 4v4h4M9 13h6M9 16.5h6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <h3 className="text-base font-semibold text-[#29433f]">Tu bandeja está al día</h3>
          <p className="mt-1 max-w-xs text-sm leading-6 text-[#778984]">
            Las nuevas propuestas aparecerán aquí para que puedas revisarlas con calma.
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
            const networkPreview = platformPreview[post.id] || "facebook";
            const previewCaption = platformCaptions(post.generatedCaption)[networkPreview];

            return (
              <li
                key={post.id}
                className="app-card studio-proposal overflow-hidden"
              >
                <article className="studio-proposal-grid grid gap-0 sm:grid-cols-[minmax(240px,290px)_minmax(0,1fr)]">
                  <div className="studio-proposal-media overflow-hidden bg-[#edf3ef]">
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
                      <video
                        className="studio-proposal-media-content"
                        src={mediaSource(post)}
                        controls
                        preload="metadata"
                        onError={() => setMediaErrors((previous) => ({ ...previous, [post.id]: "No se pudo cargar el video guardado." }))}
                      />
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
                  <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-[#173b3a]">
                        {post.procedureName}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-[#8a9994]">
                        Creado el {formatCreatedAt(post.createdAt)}
                      </p>
                    </div>

                    {!isTextIdea && (
                      <p className="studio-clinical-review" role="note">
                        Verifica que el procedimiento seleccionado corresponda realmente a este caso.
                        La IA redacta a partir de la información proporcionada; una fotografía no confirma por sí sola el tratamiento realizado.
                      </p>
                    )}

                    {!isTextIdea && (
                      <div className="rounded-lg border border-[#cbdcd4] bg-[#f5faf7] p-3 text-sm">
                        {post.clinicalVerifiedAt ? (
                          <p className="font-semibold text-[#126b5d]">Revisión clínica confirmada</p>
                        ) : (
                          <>
                            <label className="flex items-start gap-2">
                              <input type="checkbox" checked={Boolean(clinicalChecks[post.id])}
                                onChange={(event) => setClinicalChecks((current) => ({ ...current, [post.id]: event.target.checked }))}
                                disabled={isBusy} className="mt-1" />
                              <span>He verificado que el procedimiento, la fotografía, el texto y las autorizaciones corresponden a este caso.</span>
                            </label>
                            <button type="button" className="mt-2 rounded-lg border border-[#b7d7ce] bg-white px-3 py-2 font-semibold text-[#176c63] disabled:opacity-50"
                              disabled={isBusy || !clinicalChecks[post.id] || editingId === post.id}
                              onClick={() => void runAction(post.id, () => onConfirmClinical(post.id))}>
                              Confirmar revisión clínica
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {(post.educationalCaption || post.commercialCaption) && (
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
                                post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING"}
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
                    {post.visualSummary && (
                      <p className="text-xs leading-5 text-[#607771]">
                        Observación visual IA (no diagnóstica): {post.visualSummary}
                      </p>
                    )}

                    {!isTextIdea && editingId !== post.id && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#526762]" aria-label="Vista previa del texto por plataforma">
                        <span>Vista del copy:</span>
                        {(["facebook", "instagram"] as const).map((network) =>
                          <button key={network} type="button" aria-pressed={networkPreview === network}
                            onClick={() => setPlatformPreview((current) => ({ ...current, [post.id]: network }))}
                            className={networkPreview === network
                              ? "rounded-full bg-[#176c63] px-3 py-1.5 font-semibold text-white"
                              : "rounded-full border border-[#cbdcd4] bg-white px-3 py-1.5 font-semibold text-[#176c63]"}>
                            {network === "facebook" ? "Facebook" : "Instagram"}
                          </button>
                        )}
                        <span>Imagen 4:5, sin recorte clínico</span>
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
                        <p className={expandedPosts.includes(post.id)
                          ? "whitespace-pre-wrap text-sm leading-6 text-[#526762]"
                          : "line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#526762]"}>
                          {isTextIdea ? post.generatedCaption : previewCaption}
                        </p>
                        {(isTextIdea ? post.generatedCaption : previewCaption).length > 170 && (
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

                    <div className="flex flex-wrap gap-2" aria-label="Estado por red social">
                      {networkStatus("Facebook", post.facebookStatus)}
                      {networkStatus("Instagram", post.instagramStatus)}
                    </div>

                    {(post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING" || (post.facebookRetryCount ?? 0) > 0 || (post.instagramRetryCount ?? 0) > 0) && (
                      <div className="flex flex-wrap gap-2">
                        {retryButton(post, "facebook")}
                        {retryButton(post, "instagram")}
                      </div>
                    )}

                    {(post.facebookPostId || post.instagramPostId) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["facebook", "instagram"] as const).map((network) => {
                      const objectId = network === "facebook" ? post.facebookPostId : post.instagramPostId;
                      if (!objectId) return null;
                      const lookupKey = `${post.id}:${network}`;
                      return (
                        <div key={lookupKey} className="min-w-0">
                          <button
                            type="button"
                            disabled={busyId === post.id}
                            className="rounded-lg border border-[#cbdcd4] bg-white px-3 py-2 text-xs font-medium text-[#176c63] disabled:opacity-50"
                            onClick={() => {
                              void runAction(post.id, async () => {
                                const lookup = await onLookup(post.id, network);
                                setLookupMessages((messages) => ({ ...messages, [lookupKey]: lookup.message }));
                              });
                            }}
                          >
                            Comprobar ID en {network === "facebook" ? "Facebook" : "Instagram"}
                          </button>
                          {lookupMessages[lookupKey] && (
                            <p role="status" className="mt-2 max-w-sm text-xs leading-5 text-[#526762]">{lookupMessages[lookupKey]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {(post.facebookPostId || post.instagramPostId) && (
                  <div className="mt-3 space-y-1 break-all font-mono text-xs text-[#657873]">
                    {post.facebookPostId && <p>Facebook · ID: {post.facebookPostId}</p>}
                    {post.instagramPostId && <p>Instagram · ID: {post.instagramPostId}</p>}
                  </div>
                )}
                {post.mediaUrl && !post.clinicalVerifiedAt && (
                  <div className="mt-3 rounded-lg border border-[#cbdcd4] bg-[#f5faf7] p-3 text-sm">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={Boolean(clinicalChecks[post.id])}
                        disabled={busyId === post.id}
                        onChange={(event) => setClinicalChecks((current) => ({ ...current, [post.id]: event.target.checked }))}/>
                      <span>He comprobado que el procedimiento, el contenido y las autorizaciones corresponden a este caso.</span>
                    </label>
                    <button type="button" disabled={busyId === post.id || !clinicalChecks[post.id] ||
                      ["UNKNOWN", "IN_PROGRESS"].includes(post.facebookStatus || "") ||
                      ["UNKNOWN", "IN_PROGRESS"].includes(post.instagramStatus || "")}
                      className="mt-2 rounded-lg border border-[#b7d7ce] bg-white px-3 py-2 font-semibold text-[#176c63] disabled:opacity-50"
                      onClick={() => void runAction(post.id, () => onConfirmClinical(post.id))}>
                      Confirmar revisión clínica
                    </button>
                  </div>
                )}
                {post.status === "PUBLISHED" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {retryButton(post, "facebook")}
                    {retryButton(post, "instagram")}
                  </div>
                )}
                {(post.facebookStatus === "UNKNOWN" || post.instagramStatus === "UNKNOWN" ||
                      post.facebookStatus === "IN_PROGRESS" || post.instagramStatus === "IN_PROGRESS") && (
                      <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        Meta no confirmó el resultado anterior. «Aprobar y publicar» te permitirá revisar y decidir cómo continuar; no reenviará contenido sin tu confirmación.
                      </p>
                    )}

                    {error ? (
                      <p role="alert" className="text-sm text-red-700">
                        {error}
                      </p>
                    ) : null}

                    <div className="mt-auto flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={isBusy || isTextIdea || editingId === post.id || !post.clinicalVerifiedAt}
                        onClick={() => runAction(post.id, onApprove)}
                        className="studio-primary-action rounded-lg bg-[#116f64] px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isTextIdea ? "Idea guardada" : "Aprobar y publicar"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || (post.facebookStatus !== undefined && (post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING"))}
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
                      </button>
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
                  onChange={(event) => setHistoryNetwork(event.target.value as "all" | "facebook" | "instagram")}
                  className="min-h-10 rounded-lg border border-[#d1dfd6] bg-white px-3 text-sm"
                >
                  <option value="all">Todas las plataformas</option>
                  <option value="facebook">Con actividad en Facebook</option>
                  <option value="instagram">Con actividad en Instagram</option>
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
                  <option value="confirmed">Al menos una red confirmada, sin incertidumbre</option>
                  <option value="partial">Publicación parcial</option>
                  <option value="review">Requiere verificación</option>
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
              <li key={post.id} className="rounded-2xl border border-[#d7e5df] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#173b3a]">{post.procedureName}</p>
                    <p className="mt-1 text-xs text-[#82928e]">{formatCreatedAt(post.createdAt)} · {publishingSummary(post)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {networkStatus("Facebook", post.facebookStatus)}
                    {networkStatus("Instagram", post.instagramStatus)}
                  </div>
                </div>
                {(post.facebookPostId || post.instagramPostId) && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {(["facebook", "instagram"] as const).map((network) => {
                      const objectId = network === "facebook" ? post.facebookPostId : post.instagramPostId;
                      if (!objectId) return null;
                      const lookupKey = `${post.id}:${network}`;
                      return (
                        <div key={lookupKey}>
                          <p className="max-w-xs break-all text-xs text-[#657873]">
                            {network === "facebook" ? "Facebook" : "Instagram"} · ID: {objectId}
                          </p>
                          <button
                            type="button"
                            disabled={busyId === post.id}
                            className="mt-2 rounded-lg border border-[#cbdcd4] bg-white px-3 py-2 text-xs font-medium text-[#176c63] disabled:opacity-50"
                            onClick={() => {
                              void runAction(post.id, async () => {
                                const lookup = await onLookup(post.id, network);
                                setLookupMessages((current) => ({ ...current, [lookupKey]: lookup.message }));
                              });
                            }}
                          >
                            Comprobar ID en {network === "facebook" ? "Facebook" : "Instagram"}
                          </button>
                          {lookupMessages[lookupKey] && (
                            <p role="status" className="mt-1 max-w-sm text-xs text-[#526762]">{lookupMessages[lookupKey]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {post.status === "PUBLISHED" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {retryButton(post, "facebook")}
                    {retryButton(post, "instagram")}
                  </div>
                )}
                {verificationControl(post, "facebook")}
                {verificationControl(post, "instagram")}
                <div className="mt-3 flex justify-end">{deleteButton(post)}</div>
                {(post.facebookStatus === "UNKNOWN" || post.instagramStatus === "UNKNOWN" ||
                  post.facebookStatus === "IN_PROGRESS" || post.instagramStatus === "IN_PROGRESS") && (
                    <p className="mt-3 text-sm text-amber-800">Estado sin confirmar: verifica directamente en Meta antes de cualquier nuevo envío.</p>
                  )}
              </li>
            )) : <li className="text-sm text-[#637773]">No hay registros que coincidan con los filtros.</li>}
          </ul>
          {pageNav(Math.min(historyPage, historyPages), historyPages, setHistoryPage)}
          </>
        )}
      </section>}
    </section>
  );
}
