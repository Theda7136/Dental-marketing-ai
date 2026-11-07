"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import {
  ApprovalQueue,
  type ApprovalQueuePost,
} from "../../components/ApprovalQueue";
import { clinicalGuardrails } from "../../config/clinicalGuardrails";
import { createTextProposal, approveAndPublishPost, rejectPost } from "./actions";

type ContentFormat = "photo" | "video" | "text";

const FORMATS: { id: ContentFormat; label: string; ariaLabel: string }[] = [
  { id: "photo", label: "Foto", ariaLabel: "Foto de caso" },
  { id: "video", label: "Video", ariaLabel: "Video o Reel" },
  { id: "text", label: "Guion", ariaLabel: "Idea de texto o guion" },
];

// Componente visual optimizado para consultar el estado real de la cuenta vinculada
function AccountConnector() {
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const error = new URLSearchParams(window.location.search).get("error");
    const messages: Record<string, string> = {
      no_page: "Meta no encontró una Página que puedas administrar. Revisa el acceso del usuario a la Página de la clínica e inténtalo otra vez.",
      multiple_pages: "Tu usuario administra varias Páginas. Configura META_PAGE_ID con el ID de la Página de la clínica en .env y vuelve a conectar Meta.",
      page_not_found: "No se encontró la Página indicada en META_PAGE_ID. Revisa el ID y vuelve a conectar Meta.",
      pages_failed: "Meta no pudo consultar tus Páginas. Revisa los permisos concedidos e inténtalo otra vez.",
      token_failed: "Meta no pudo completar la autorización. Inténtalo de nuevo.",
      token_exchange_failed: "Meta no pudo completar la autorización de larga duración. Reconecta la Página e inténtalo otra vez.",
      invalid_state: "La autorización de Meta caducó o no coincide. Inténtalo de nuevo.",
    };
    if (error && messages[error]) setConnectionMessage(messages[error]);
    fetch("/api/social/accounts")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setAccountInfo(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleConnect = () => {
    window.location.href = "/api/auth/meta";
  };

  return (
    <div className="app-card rounded-3xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e8f4f0] text-[#176c63]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7"><path d="M8 12a4 4 0 0 1 4-4h2a4 4 0 1 1 0 8h-2M16 12a4 4 0 0 1-4 4h-2a4 4 0 1 1 0-8h2" strokeLinecap="round"/></svg>
          </span>
          <div>
          <p className="eyebrow mb-1">Canales conectados</p>
          <h3 className="text-base font-semibold tracking-tight text-[#173b3a]">Cuentas de redes sociales</h3>
          {connectionMessage ? (
            <p role="alert" className="mt-2 max-w-xl text-sm text-red-700">{connectionMessage}</p>
          ) : null}
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#637773]">
            {loading
              ? "Verificando estado de conexión..."
              : accountInfo?.connected
              ? accountInfo.instagramConnected
                ? `Conectado como ${accountInfo.userName} (${accountInfo.pageName}) en Facebook e Instagram.`
                : `Página ${accountInfo.pageName} conectada; falta vincular Instagram Business. Los posts se publicarán solo en Facebook.`
              : "Vincula la cuenta de Instagram Business para habilitar la publicación en Instagram."}
          </p>
          </div>
        </div>

        {accountInfo?.connected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Conectado
            </span>
            <button
              onClick={handleConnect}
              className="text-xs font-medium text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-[#176c63]"
            >
              Reconectar
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-gradient-to-r from-[#147c72] to-[#0d625b] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-10px_rgba(13,98,91,0.8)] transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            Conectar cuenta
          </button>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  // Limpieza segura de parámetros de URL una sola vez al cargar la página
  useEffect(() => {
    if (window.location.search.includes("success") || window.location.search.includes("error")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const [format, setFormat] = useState<ContentFormat>("photo");
  const [posts, setPosts] = useState<ApprovalQueuePost[]>([]);
  const [fileLabel, setFileLabel] = useState("Ningún archivo seleccionado");
  const [fileKey, setFileKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Estados controlados para el formulario
  const [procedureName, setProcedureName] = useState("");
  const [notes, setNotes] = useState("");

  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let isMounted = true;

    fetch("/api/posts")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error?.message || "No se pudieron cargar las publicaciones.");
        }
        return payload.posts as ApprovalQueuePost[];
      })
      .then((savedPosts) => {
        if (isMounted) setPosts(savedPosts);
      })
      .catch((error) => {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar las publicaciones.");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Manejador del envío del formulario con actualización inmediata del estado
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    const formData = new FormData(event.currentTarget);
    formData.set("procedureName", procedureName);
    formData.set("notes", notes);

    startTransition(async () => {
      let result: {
        ok: boolean;
        post?: ApprovalQueuePost;
        message?: string;
      };
      if (format === "text") {
        result = await createTextProposal(formData);
      } else {
        const response = await fetch("/api/create-post", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json();
        result = response.ok
          ? {
              ok: true,
              post: {
                ...payload.post,
                mediaKind: format === "video" ? "video" : "image",
              },
            }
          : {
              ok: false,
              message: payload.error?.message || "No se pudo crear la publicación.",
            };
      }

      if (result.ok && result.post) {
        setPosts((current) => [result.post!, ...current]);
        formRef.current?.reset();
        setProcedureName("");
        setNotes("");
        setFileLabel("Ningún archivo seleccionado");
        setFileKey((current) => current + 1);
        setNotice("La propuesta quedó en Posts pendientes de aprobación.");
      } else {
        setErrorMessage(result.message || "No se pudo crear la propuesta.");
      }
    });
  }

  function changeFormat(next: ContentFormat) {
    setFormat(next);
    setFileLabel("Ningún archivo seleccionado");
    setFileKey((current) => current + 1);
  }

  // Manejador para aprobar y publicar directamente en Instagram y Facebook
  async function approvePost(postId: string) {
    setErrorMessage(null);
    setNotice(null);

    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    startTransition(async () => {
      const result = await approveAndPublishPost(targetPost.id);

      if (result.ok) {
        setPosts((current) =>
          current.map((post) =>
            post.id === postId
              ? { ...post, status: "PUBLISHED", approvedAt: result.approvedAt }
              : post,
          ),
        );
        setNotice(
          result.warnings?.length
            ? `Publicado, pero revisa este aviso: ${result.warnings.join(" ")}`
            : "¡Publicado en las redes conectadas!",
        );
      } else {
        setErrorMessage(`Error al publicar: ${result.message}`);
      }
    });
  }

  async function handleEditPost(post: ApprovalQueuePost) {
    const rejected = await rejectPost(post.id);
    if (!rejected.ok) {
      setErrorMessage(rejected.message || "No se pudo actualizar la publicación.");
      return;
    }

    setProcedureName(post.procedureName);
    const baseNote = post.generatedCaption.split("\n\n")[0] || "";
    setNotes(baseNote);

    if (post.mediaKind === "text") {
      setFormat("text");
    } else {
      setFormat("photo");
    }

    setPosts((current) => current.filter((p) => p.id !== post.id));
    setNotice("Post cargado en el formulario. Edítalo y vuelve a generar.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="app-shell mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
      <header className="flex flex-col gap-6 border-b soft-divider pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.65"><path d="M8 4.5c-2.2 0-3.5 1.7-3.5 4.2 0 3.2 1.6 8.2 3 10 .6.8 1.4.6 1.7-.4l1.2-3.8c.2-.7 1.2-.7 1.4 0l1.2 3.8c.3 1 1.1 1.2 1.7.4 1.4-1.8 3-6.8 3-10 0-2.5-1.3-4.2-3.5-4.2-1.3 0-1.8.6-3.1.6S9.3 4.5 8 4.5Z" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 7v4m-2-2h4" strokeLinecap="round"/></svg>
          </span>
          <div>
            <p className="eyebrow">Dental Studio <span className="mx-1 text-[#9bbcb3]">/</span> Clínica piloto</p>
            <p className="mt-1 text-xs font-medium text-[#82928e]">Espacio de contenido</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="eyebrow">Marketing dental</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#173b3a] sm:text-[1.8rem]">Panel de contenido</h1>
          <p className="mt-1 max-w-lg text-sm leading-6 text-[#637773] sm:ml-auto">
            Prepara fotos, videos y guiones; revisa cada propuesta antes de publicarla.
          </p>
        </div>
      </header>

      {/* Módulo de Conexión de Cuentas OAuth dinámico */}
      <AccountConnector />

      {errorMessage ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
          {errorMessage}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 shadow-sm">
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] xl:gap-8">
        <section aria-labelledby="new-case-title" className="app-card rounded-3xl p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f4f0] text-xs font-bold text-[#176c63]">01</span>
            <div>
          <p className="eyebrow mb-1">Crear contenido</p>
          <h2 id="new-case-title" className="text-lg font-semibold tracking-tight text-[#173b3a]">Nuevo caso</h2>
          <p className="mt-1 text-sm leading-6 text-[#637773]">
            El material se prepara en la clínica y el texto queda en revisión.
          </p>
            </div>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
            <div>
            <p className="mb-2 text-xs font-semibold text-[#637773]">Formato del contenido</p>
            <div role="tablist" aria-label="Formato del contenido" className="grid grid-cols-3 gap-2 rounded-2xl bg-[#f3f6f3] p-1.5">
              {FORMATS.map((item) => {
                const selected = format === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-label={item.ariaLabel}
                    aria-selected={selected}
                    disabled={isPending}
                    onClick={() => changeFormat(item.id)}
                    className={`min-h-11 whitespace-nowrap rounded-xl px-2 text-xs font-semibold leading-4 transition sm:text-sm disabled:opacity-60 ${
                      selected
                        ? "bg-white text-[#176c63] shadow-[0_2px_8px_rgba(22,67,59,0.10)]"
                        : "text-[#758783] hover:bg-white/70 hover:text-[#315b54]"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium text-stone-800">
              Procedimiento
              <select
                name="procedureName"
                required
                disabled={isPending}
                value={procedureName}
                onChange={(e) => setProcedureName(e.target.value)}
                className="field-control h-12 rounded-xl px-3 text-base text-stone-900 outline-none disabled:opacity-60"
              >
                <option value="" disabled>Elige un procedimiento</option>
                {clinicalGuardrails.allowedDentalTerms.map((term) => (
                  <option key={term} value={term}>{term}</option>
                ))}
              </select>
            </label>

            {format !== "text" ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-stone-800">
                  {format === "video" ? "Video clínico" : "Foto clínica"}
                </span>
                <label className="group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#c9d9d2] bg-[#f8faf8] px-4 py-6 text-center transition hover:border-[#398e82] hover:bg-[#f2f8f5]">
                  <span className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-white text-[#398e82] shadow-sm transition group-hover:scale-105" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                  <span className="text-sm font-semibold text-[#245e57]">
                    {format === "video" ? "Elegir video" : "Elegir foto"}
                  </span>
                  <span className="mt-1 max-w-full truncate text-xs text-[#82928e]">{fileLabel}</span>
                  <input
                    key={fileKey}
                    name="photo"
                    type="file"
                    required
                    disabled={isPending}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      setFileLabel(file ? file.name : "Ningún archivo seleccionado");
                    }}
                  />
                </label>
              </div>
            ) : null}

            <label className="flex flex-col gap-2 text-sm font-medium text-stone-800">
              Notas de la consulta o idea del video
              <textarea
                name="notes"
                rows={4}
                maxLength={800}
                disabled={isPending}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Paciente con hipersensibilidad..."
              className="field-control resize-y rounded-xl px-3 py-3 text-base leading-6 text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60"
              />
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#147c72] to-[#0d625b] px-4 py-3 text-sm font-semibold leading-5 text-white shadow-[0_10px_22px_-12px_rgba(13,98,91,0.75)] transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Grok-3 está redactando la propuesta...
                </>
              ) : (
                "Generar propuesta"
              )}
            </button>
          </form>
        </section>

        <ApprovalQueue
          posts={posts}
          onApprove={approvePost}
          onEdit={handleEditPost}
        />
      </div>
    </main>
  );
}
