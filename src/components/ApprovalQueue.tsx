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
  createdAt: Date | string;
  approvedAt?: Date | string | null;
  /** Foto, video o guion. Si no viene, se infiere por la URL. */
  mediaKind?: "image" | "video" | "text";
}

interface ApprovalQueueProps {
  posts: readonly ApprovalQueuePost[];
  onApprove: (postId: string) => void | Promise<void>;
  onEdit: (post: ApprovalQueuePost) => void | Promise<void>;
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
}: ApprovalQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    <section aria-labelledby="approval-queue-title" className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <p className="text-sm font-medium tracking-wide text-teal-800">
          Revisión clínica
        </p>
        <h2
          id="approval-queue-title"
          className="mt-1 text-2xl font-semibold text-stone-900"
        >
          Posts pendientes de aprobación
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {pendingPosts.length === 0
            ? "No hay publicaciones esperando revisión."
            : `${pendingPosts.length} ${pendingPosts.length === 1 ? "publicación espera" : "publicaciones esperan"} tu decisión.`}
        </p>
      </header>

      {pendingPosts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-stone-600">
          Cuando Grok genere un post, aparecerá aquí en estado pendiente.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {pendingPosts.map((post) => {
            const isBusy = busyId === post.id;
            const error = errors[post.id];

            return (
              <li
                key={post.id}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
              >
                <article className="grid gap-0 sm:grid-cols-[220px_1fr]">
                  <div className="bg-stone-100">
                    {post.mediaKind === "text" || post.mediaUrl.length === 0 ? (
                      <div className="flex h-56 items-center justify-center px-6 text-center text-sm font-medium text-teal-900 sm:h-full">
                        Guion
                      </div>
                    ) : post.mediaKind === "video" || isVideoUrl(post.mediaUrl) ? (
                      <video
                        className="h-56 w-full object-cover sm:h-full"
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

                  <div className="flex flex-col gap-4 p-5">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">
                        {post.procedureName}
                      </h3>
                      <p className="mt-1 text-sm text-stone-500">
                        Creado el {formatCreatedAt(post.createdAt)}
                      </p>
                    </div>

                    <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">
                      {post.generatedCaption}
                    </p>

                    {error ? (
                      <p role="alert" className="text-sm text-red-700">
                        {error}
                      </p>
                    ) : null}

                    <div className="mt-auto flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => runAction(post.id, onApprove)}
                        className="rounded-full bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Aprobar y Programar
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEdit(post)}
                        className="rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Editar y Regenerar
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}