"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import {
  ApprovalQueue,
  type ApprovalQueuePost,
} from "../../components/ApprovalQueue";
import { clinicalGuardrails } from "../../config/clinicalGuardrails";
import { createMarketingProposal, createTextProposal, approveAndPublishPost } from "./actions";

type ContentFormat = "photo" | "video" | "text";

const FORMATS: { id: ContentFormat; label: string }[] = [
  { id: "photo", label: "Foto de Caso" },
  { id: "video", label: "Video / Reel" },
  { id: "text", label: "Idea de Texto / Guion" },
];

// Componente visual optimizado para consultar el estado real de la cuenta vinculada
function AccountConnector() {
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
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
    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-stone-900">Cuentas de Redes Sociales</h3>
          <p className="mt-1 text-sm text-stone-600">
            {loading
              ? "Verificando estado de conexión..."
              : accountInfo?.connected
              ? `Conectado como ${accountInfo.userName} (${accountInfo.pageName})`
              : "Vincula la cuenta de Instagram Business para habilitar la publicación y programación directa de anuncios."}
          </p>
        </div>

        {accountInfo?.connected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              ● Conectado
            </span>
            <button
              onClick={handleConnect}
              className="text-xs text-stone-500 hover:text-stone-700 underline"
            >
              Reconectar
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            className="inline-flex items-center justify-center rounded-full bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900"
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

  // Manejador del envío del formulario con actualización inmediata del estado
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    const formData = new FormData(event.currentTarget);
    formData.set("procedureName", procedureName);
    formData.set("notes", notes);

    startTransition(async () => {
      let result;
      if (format === "text") {
        result = await createTextProposal(formData);
      } else {
        result = await createMarketingProposal(formData);
      }

      if (result.ok) {
        setPosts((current) => [
          ...current,
          { ...result.post, mediaKind: format === "text" ? "text" : "image" },
        ]);
        formRef.current?.reset();
        setProcedureName("");
        setNotes("");
        setFileLabel("Ningún archivo seleccionado");
        setFileKey((current) => current + 1);
        setNotice("La propuesta quedó en Posts pendientes de aprobación.");
      } else {
        setErrorMessage(result.message);
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
      const result = await approveAndPublishPost({
        id: targetPost.id,
        mediaUrl: targetPost.mediaUrl || "",
        generatedCaption: targetPost.generatedCaption,
        mediaKind: targetPost.mediaKind,
      });

      if (result.ok) {
        setPosts((current) =>
          current.map((post) =>
            post.id === postId
              ? { ...post, status: "PUBLISHED", approvedAt: new Date().toISOString() }
              : post,
          ),
        );
        setNotice("¡Publicado con éxito en Instagram y Facebook!");
      } else {
        setErrorMessage(`Error al publicar: ${result.message}`);
      }
    });
  }

  function handleEditPost(post: ApprovalQueuePost) {
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-6">
        <p className="text-sm font-medium tracking-wide text-teal-800">Consulta dental</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Panel de contenido</h1>
          <p className="max-w-md text-sm leading-6 text-stone-600">
            Prepara la foto, el video o el guion del caso y revísalo antes de publicarlo.
          </p>
        </div>
      </header>

      {/* Módulo de Conexión de Cuentas OAuth dinámico */}
      <AccountConnector />

      {errorMessage ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-labelledby="new-case-title" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 id="new-case-title" className="text-lg font-semibold text-stone-950">Nuevo caso</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            El material se prepara en la clínica y el texto queda en revisión.
          </p>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
            <div role="tablist" aria-label="Formato del contenido" className="grid gap-2">
              {FORMATS.map((item) => {
                const selected = format === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    disabled={isPending}
                    onClick={() => changeFormat(item.id)}
                    className={`h-11 rounded-2xl border px-3 text-sm font-semibold transition disabled:opacity-60 ${
                      selected
                        ? "border-teal-800 bg-teal-800 text-white"
                        : "border-stone-300 bg-stone-50 text-stone-700 hover:border-teal-800 hover:bg-white"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium text-stone-800">
              Procedimiento
              <select
                name="procedureName"
                required
                disabled={isPending}
                value={procedureName}
                onChange={(e) => setProcedureName(e.target.value)}
                className="h-12 rounded-2xl border border-stone-300 bg-stone-50 px-3 text-base text-stone-900 outline-none transition focus:border-teal-800 focus:bg-white disabled:opacity-60"
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
                <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center transition hover:border-teal-800 hover:bg-white">
                  <span className="text-sm font-semibold text-teal-900">
                    {format === "video" ? "Elegir video" : "Elegir foto"}
                  </span>
                  <span className="mt-2 text-sm text-stone-600">{fileLabel}</span>
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
                className="resize-y rounded-2xl border border-stone-300 bg-stone-50 px-3 py-3 text-base leading-6 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-800 focus:bg-white disabled:opacity-60"
              />
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="min-h-12 rounded-full bg-teal-800 px-4 py-3 text-sm font-semibold leading-5 text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
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