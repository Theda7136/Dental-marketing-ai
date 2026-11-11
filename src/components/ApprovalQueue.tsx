"use client";

import { useMemo, useState } from "react";

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
  status: PostStatus;
  facebookStatus?: string;
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
  /** Foto, video o guion. Si no viene, se infiere por la URL. */
  mediaKind?: "image" | "video" | "text";
}

interface ApprovalQueueProps {
  posts: readonly ApprovalQueuePost[];
  onApprove: (postId: string) => void | Promise<void>;
  onEdit: (post: ApprovalQueuePost, caption: string) => Promise<void>;
  onRetry: (postId: string, network: "facebook" | "instagram") => Promise<void>;
  onVerify: (postId: string, network: "facebook" | "instagram", outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN", evidence: string) => Promise<void>;
  onLookup: (postId: string, network: "facebook" | "instagram") => Promise<{ ok: boolean; message: string }>;
  onCheckMedia: (postId: string) => Promise<{ ok: boolean; message: string }>;
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

export function ApprovalQueue({
  posts,
  onApprove,
  onEdit,
  onRetry,
  onVerify,
  onLookup,
  onCheckMedia,
}: ApprovalQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [expandedPosts, setExpandedPosts] = useState<string[]>([]);
  const [showPublished, setShowPublished] = useState(false);
  const [historyNetwork, setHistoryNetwork] = useState<"all" | "facebook" | "instagram">("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<"FOUND" | "NOT_FOUND" | "UNCERTAIN">("UNCERTAIN");
  const [reviewEvidence, setReviewEvidence] = useState("");
  const [lookupMessages, setLookupMessages] = useState<Record<string, string>>({});
  const [mediaChecks, setMediaChecks] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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
            <p className="text-xs text-[#806b49]">Registrar una revisión no autoriza un nuevo envío.</p>
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
    if (post.mediaUrl.length === 0 || post[network === "facebook" ? "facebookStatus" : "instagramStatus"] !== "PENDING") {
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
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f4f0] text-xs font-bold text-[#176c63]">02</span>
          <div>
        <p className="eyebrow mb-1">
          Revisión clínica
        </p>
        <h2
          id="approval-queue-title"
          className="text-xl font-semibold tracking-tight text-[#173b3a] sm:text-2xl"
        >
          Pendientes de aprobación
        </h2>
        <p className="mt-1 text-sm text-[#637773]">
          {pendingPosts.length === 0
            ? "Revisa aquí cada propuesta antes de compartirla."
            : `${pendingPosts.length} ${pendingPosts.length === 1 ? "propuesta espera" : "propuestas esperan"} tu revisión.`}
        </p>
          </div>
        </div>
        <span className="ml-12 inline-flex w-fit items-center rounded-full border border-[#d7e5df] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#55716b] sm:ml-0">
          {pendingPosts.length} {pendingPosts.length === 1 ? "pendiente" : "pendientes"}
        </span>
      </header>

      {pendingPosts.length === 0 ? (
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
          {pendingPosts.map((post) => {
            const isBusy = busyId === post.id;
            const isTextIdea = post.mediaKind === "text" || post.mediaUrl.length === 0;
            const isVideo = post.mediaKind === "video" || isVideoUrl(post.mediaUrl);
            const error = errors[post.id];

            return (
              <li
                key={post.id}
                className="app-card overflow-hidden rounded-3xl transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_52px_-32px_rgba(24,58,52,0.45)]"
              >
                <article className="grid gap-0 sm:grid-cols-[220px_1fr]">
                  <div className="h-44 overflow-hidden bg-[#edf3ef] sm:h-52">
                    {post.mediaKind === "text" || post.mediaUrl.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm font-semibold text-[#356e66]">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/80 shadow-sm" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.7"><path d="M7 4.75h10A1.25 1.25 0 0 1 18.25 6v12A1.25 1.25 0 0 1 17 19.25H7A1.25 1.25 0 0 1 5.75 18V6A1.25 1.25 0 0 1 7 4.75Z"/><path d="M9 9h6M9 12h6M9 15h4" strokeLinecap="round"/></svg></span>
                        Idea de contenido
                      </div>
                    ) : post.mediaKind === "video" || isVideoUrl(post.mediaUrl) ? (
                      <video
                        className="h-full w-full object-contain"
                        src={post.mediaUrl}
                        controls
                        preload="metadata"
                      />
                    ) : (
                      <img
                        className="h-56 w-full object-cover sm:h-full"
                        src={post.mediaUrl}
                        alt={`Caso de ${post.procedureName}`}
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
                          {post.generatedCaption}
                        </p>
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

                    {post.mediaUrl && post.mediaKind !== "text" && post.mediaKind !== "video" && (
                      <div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            void runAction(post.id, async () => {
                              const check = await onCheckMedia(post.id);
                              setMediaChecks((current) => ({ ...current, [post.id]: check }));
                            });
                          }}
                          className="rounded-xl border border-[#b7d7ce] bg-white px-3 py-2 text-xs font-semibold text-[#176c63] disabled:opacity-50"
                        >
                          Comprobar acceso HTTPS de imagen
                        </button>
                        {mediaChecks[post.id] && (
                          <p role="status" className={`mt-2 text-xs leading-5 ${mediaChecks[post.id].ok ? "text-[#176c63]" : "text-amber-800"}`}>
                            {mediaChecks[post.id].message}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2" aria-label="Estado por red social">
                      {networkStatus("Facebook", post.facebookStatus)}
                      {networkStatus("Instagram", post.instagramStatus)}
                    </div>

                    {(post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING") && (
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
                {post.status === "PUBLISHED" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {retryButton(post, "facebook")}
                    {retryButton(post, "instagram")}
                  </div>
                )}
                {(post.facebookStatus === "UNKNOWN" || post.instagramStatus === "UNKNOWN" ||
                      post.facebookStatus === "IN_PROGRESS" || post.instagramStatus === "IN_PROGRESS") && (
                      <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        El resultado de publicación de una red no está confirmado. Comprueba la publicación directamente en Meta antes de intentar de nuevo.
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
                        disabled={isBusy || isTextIdea || editingId === post.id || (post.facebookStatus !== undefined && (post.facebookStatus !== "PENDING" || post.instagramStatus !== "PENDING"))}
                        onClick={() => runAction(post.id, onApprove)}
                        className="rounded-full bg-gradient-to-r from-[#147c72] to-[#0d625b] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-12px_rgba(13,98,91,0.75)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
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
                        className="rounded-full border border-[#d9e2dc] bg-white px-4 py-2.5 text-sm font-semibold text-[#46615b] transition hover:border-[#a8c6bb] hover:bg-[#f6faf7] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Editar texto
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-8 border-t border-[#d7e5df] pt-6" aria-labelledby="published-history-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="published-history-title" className="text-lg font-semibold text-[#173b3a]">Historial de publicaciones</h3>
            <p className="mt-1 text-sm text-[#637773]">{reviewedPosts.length} {reviewedPosts.length === 1 ? "propuesta registrada" : "propuestas registradas"} en el historial.</p>
          </div>
          <button
            type="button"
            aria-expanded={showPublished}
            onClick={() => setShowPublished((current) => !current)}
            className="rounded-xl border border-[#d7e5df] bg-white px-4 py-2 text-sm font-medium text-[#176c63]"
          >
            {showPublished ? "Ocultar historial" : "Ver historial"}
          </button>
        </div>
        {showPublished && (
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
            <p role="status" className="mt-3 text-xs text-[#637773]">
              {filteredHistory.length} de {reviewedPosts.length} registros
            </p>
            <ul className="mt-3 space-y-3">
            {filteredHistory.length ? filteredHistory.map((post) => (
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
                {(post.facebookStatus === "UNKNOWN" || post.instagramStatus === "UNKNOWN" ||
                  post.facebookStatus === "IN_PROGRESS" || post.instagramStatus === "IN_PROGRESS") && (
                    <p className="mt-3 text-sm text-amber-800">Estado sin confirmar: verifica directamente en Meta antes de cualquier nuevo envío.</p>
                  )}
              </li>
            )) : <li className="text-sm text-[#637773]">No hay registros que coincidan con los filtros.</li>}
          </ul>
          </>
        )}
      </section>
    </section>
  );
}
