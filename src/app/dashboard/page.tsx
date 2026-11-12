"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import {
  ApprovalQueue,
  type ApprovalQueuePost,
} from "../../components/ApprovalQueue";
import { clinicalGuardrails } from "../../config/clinicalGuardrails";
import { createTextProposal, approveAndPublishPost, recordDeliveryReview, retryPendingNetwork, updatePendingCaption, verifyMetaObject, chooseCopyStyle, authorizeManualRetry, confirmMissingAndRetry } from "./actions";

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
  const [copyStyle, setCopyStyle] = useState<"EDUCATIONAL" | "COMMERCIAL">("EDUCATIONAL");
  const [photoLayout, setPhotoLayout] = useState<"AUTO" | "CONTAIN" | "COVER">("AUTO");
  const [photoBackground, setPhotoBackground] = useState<"LIGHT" | "BLUR">("LIGHT");
  const [photoPreset, setPhotoPreset] = useState<"CLINICAL" | "EDUCATIONAL" | "COMMERCIAL">("CLINICAL");
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoOffsetX, setPhotoOffsetX] = useState(0);
  const [photoOffsetY, setPhotoOffsetY] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPreviewError, setPhotoPreviewError] = useState<string | null>(null);
  const [previewNetwork, setPreviewNetwork] = useState<"FACEBOOK" | "INSTAGRAM">("FACEBOOK");

  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (format !== "photo" || !selectedPhoto) {
      setPhotoPreview(null);
      setPhotoPreviewError(null);
      return;
    }

    const controller = new AbortController();
    let currentUrl: string | null = null;
    const timeout = setTimeout(async () => {
      const body = new FormData();
      body.set("photo", selectedPhoto);
      body.set("photoLayout", photoLayout);
      body.set("photoBackground", photoBackground);
      body.set("photoPreset", photoPreset);
      body.set("photoZoom", String(photoZoom));
      body.set("photoOffsetX", String(photoOffsetX));
      body.set("photoOffsetY", String(photoOffsetY));

      try {
        const response = await fetch("/api/preview-image", { method: "POST", body, signal: controller.signal });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error || "No fue posible crear la vista previa.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        currentUrl = URL.createObjectURL(blob);
        setPhotoPreview(currentUrl);
        setPhotoPreviewError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhotoPreview(null);
        setPhotoPreviewError(error instanceof Error ? error.message : "No fue posible crear la vista previa.");
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timeout);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [format, selectedPhoto, photoLayout, photoBackground, photoPreset, photoZoom, photoOffsetX, photoOffsetY]);

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
    formData.set("selectedStyle", copyStyle);
    formData.set("photoLayout", photoLayout);
    formData.set("photoBackground", photoBackground);
    formData.set("photoPreset", photoPreset);
    formData.set("photoZoom", String(photoZoom));
    formData.set("photoOffsetX", String(photoOffsetX));
    formData.set("photoOffsetY", String(photoOffsetY));

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
        setSelectedPhoto(null);
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
    setSelectedPhoto(null);
    setFileKey((current) => current + 1);
  }

  // Manejador para aprobar y publicar directamente en Instagram y Facebook
  async function approvePost(postId: string) {
    setErrorMessage(null);
    setNotice(null);

    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    const uncertain = (["facebook", "instagram"] as const).filter((network) =>
      targetPost[network === "facebook" ? "facebookStatus" : "instagramStatus"] === "UNKNOWN",
    );
    if (uncertain.length > 0) {
      if (uncertain.length !== 1) {
        setErrorMessage("Hay más de una red sin confirmar. Revisa los estados por separado antes de volver a enviar.");
        return;
      }

      const network = uncertain[0];
      const label = network === "facebook" ? "Facebook" : "Instagram";
      const confirmed = window.confirm(
        `Meta no confirmó el envío anterior a ${label}. ¿Revisaste la página y confirmas que NO existe la publicación? Si continúas, se intentará enviar una sola vez. Si sí aparece en Meta, cancela para evitar duplicados.`,
      );
      if (!confirmed) return;

      startTransition(async () => {
        const attempt = await confirmMissingAndRetry(postId, network);
        try {
          const response = await fetch("/api/posts", { cache: "no-store" });
          if (!response.ok) throw new Error("No se pudo recargar la información.");
          const payload = await response.json();
          setPosts(payload.posts as ApprovalQueuePost[]);
        } catch {
          setErrorMessage("El intento pudo haberse procesado. Recarga el historial antes de otra acción.");
          return;
        }

        if (attempt.ok) setNotice(attempt.message);
        else setErrorMessage(attempt.message);
      });
      return;
    }
    if (targetPost.facebookStatus !== "PENDING" || targetPost.instagramStatus !== "PENDING") {
      setErrorMessage("La publicación ya fue enviada a una red. Revisa el estado de cada plataforma antes de continuar.");
      return;
    }

    if (!window.confirm("La aprobación publicará este contenido inmediatamente en las redes conectadas. ¿Confirmas que el material y el texto están autorizados para publicar?")) {
      return;
    }

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
        setErrorMessage(`No se pudo confirmar la publicación: ${result.message}. Revisa el estado de cada red antes de volver a intentar.`);
      }

      try {
        const response = await fetch("/api/posts", { cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo actualizar el estado de las publicaciones.");
        const payload = await response.json();
        setPosts(payload.posts as ApprovalQueuePost[]);
      } catch {
        setErrorMessage("Actualiza la página para consultar los estados guardados antes de volver a publicar.");
      }
    });
  }

  async function retryNetwork(postId: string, network: "facebook" | "instagram") {
    setErrorMessage(null);
    setNotice(null);

    const result = await retryPendingNetwork(postId, network);
    try {
      const response = await fetch("/api/posts", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo consultar el estado de las publicaciones.");
      const payload = await response.json();
      setPosts(payload.posts as ApprovalQueuePost[]);
    } catch {
      throw new Error("El estado de publicación puede haber cambiado. Recarga el panel y verifica Meta antes de intentar nuevamente.");
    }

    if (!result.ok) throw new Error(result.message);
    setNotice(result.message);
  }

  async function reconcileRetry(postId: string, network: "facebook" | "instagram") {
    const decision = await authorizeManualRetry(postId, network);
    if (!decision.ok) throw new Error(decision.message);

    const response = await fetch("/api/posts", { cache: "no-store" });
    if (!response.ok) throw new Error("El reintento quedó habilitado; recarga el panel para ver el estado.");
    const payload = await response.json();
    setPosts(payload.posts as ApprovalQueuePost[]);
    setNotice(decision.message);
  }

  async function changeCopyStyle(postId: string, style: "EDUCATIONAL" | "COMMERCIAL") {
    const chosen = await chooseCopyStyle(postId, style);
    if (!("caption" in chosen) || !chosen.caption) {
      throw new Error("message" in chosen ? chosen.message : "No se pudo seleccionar el estilo.");
    }

    setPosts((current) => current.map((post) =>
      post.id === postId
        ? { ...post, selectedStyle: style, generatedCaption: chosen.caption! }
        : post,
    ));
    setNotice(style === "EDUCATIONAL" ? "Versión educativa seleccionada." : "Versión comercial seleccionada.");
  }

  async function lookupMetaId(postId: string, network: "facebook" | "instagram") {
    return verifyMetaObject(postId, network);
  }

  async function verifyNetwork(
    postId: string,
    network: "facebook" | "instagram",
    outcome: "FOUND" | "NOT_FOUND" | "UNCERTAIN",
    evidence: string,
  ) {
    const review = await recordDeliveryReview(postId, network, outcome, evidence);
    if (!review.ok) throw new Error(review.message);

    const response = await fetch("/api/posts", { cache: "no-store" });
    if (!response.ok) throw new Error("La verificación se guardó, pero no se pudo recargar el historial. Actualiza la página.");
    const payload = await response.json();
    setPosts(payload.posts as ApprovalQueuePost[]);
    setNotice(review.message);
  }

  async function handleEditPost(post: ApprovalQueuePost, caption: string) {
    const revised = await updatePendingCaption(post.id, caption);
    if (!revised.ok || !revised.caption) {
      throw new Error(revised.message || "No se pudo actualizar la propuesta.");
    }

    setPosts((current) => current.map((savedPost) =>
      savedPost.id === post.id
        ? { ...savedPost, generatedCaption: revised.caption! }
        : savedPost,
    ));
    setNotice("Texto actualizado. La propuesta conserva su archivo y sigue pendiente de aprobación.");
  }

  return (
    <main className="studio-workspace app-shell">
      <a href="#studio-main" className="studio-skip-link">Saltar al contenido</a>
      <aside className="studio-sidebar" aria-label="Navegación principal">
        <a href="#studio-main" className="studio-identity" aria-label="Dental Studio, inicio">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="23" height="23" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 4.5c-2.2 0-3.5 1.7-3.5 4.2 0 3.2 1.6 8.2 3 10 .6.8 1.4.6 1.7-.4l1.2-3.8c.2-.7 1.2-.7 1.4 0l1.2 3.8c.3 1 1.1 1.2 1.7.4 1.4-1.8 3-6.8 3-10 0-2.5-1.3-4.2-3.5-4.2-1.3 0-1.8.6-3.1.6S9.3 4.5 8 4.5Z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 7v4m-2-2h4" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="studio-identity-copy"><strong>Dental Studio</strong><small>Marketing clínico</small></span>
        </a>
        <div className="studio-sidebar-label">ESPACIO DE TRABAJO</div>
        <nav className="studio-nav" aria-label="Secciones">
          <a className="studio-nav-link is-current" href="#create-content"><span aria-hidden="true">01</span> Crear contenido</a>
          <a className="studio-nav-link" href="#approval-queue-title"><span aria-hidden="true">02</span> Pendientes</a>
          <a className="studio-nav-link" href="#published-history-title"><span aria-hidden="true">03</span> Historial</a>
          <a className="studio-nav-link" href="#connected-accounts"><span aria-hidden="true">04</span> Conexiones</a>
        </nav>
        <div className="studio-sidebar-footer">
          <span className="studio-availability"><span className="studio-availability-dot" /> Espacio de clínica piloto</span>
          <p>Todo contenido requiere revisión antes de publicarse.</p>
        </div>
      </aside>
      <div className="studio-main" id="studio-main">
        <header className="studio-topbar">
          <div>
            <p className="eyebrow">ESTUDIO / CONTENIDO</p>
            <h1>Panel de contenido</h1>
            <p>Prepara, revisa y publica material odontológico desde un solo lugar.</p>
          </div>
          <a href="#create-content" className="studio-topbar-link">Nueva propuesta <span aria-hidden="true">↗</span></a>
        </header>
        <div className="studio-content">
          <section id="connected-accounts" aria-label="Canales conectados">
      <AccountConnector />

          </section>
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

      <div className="studio-editor-grid">
        <section id="create-content" aria-labelledby="new-case-title" className="app-card studio-form-panel rounded-3xl p-5 sm:p-6">
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

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-stone-800">Enfoque de la propuesta</legend>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#edf4f0] p-1.5">
                {(["EDUCATIONAL", "COMMERCIAL"] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={copyStyle === style}
                    disabled={isPending}
                    onClick={() => setCopyStyle(style)}
                    className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                      copyStyle === style
                        ? "bg-white text-[#176c63] shadow-sm ring-1 ring-[#bfd8d0]"
                        : "text-[#55736b] hover:bg-white/70"
                    }`}
                  >
                    {style === "EDUCATIONAL" ? "Educativa" : "Comercial"}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-[#637773]">
                {copyStyle === "EDUCATIONAL"
                  ? "Contenido informativo para orientar a pacientes."
                  : "Contenido que invita a agendar una valoración sin prometer resultados."}
              </p>
            </fieldset>

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
                      setSelectedPhoto(format === "photo" ? file || null : null);
                    }}
                  />
                </label>
              </div>
            ) : null}

            {format === "photo" && (
              <section className="space-y-3 rounded-2xl border border-[#d7e5df] bg-[#f7faf8] p-3" aria-label="Ajuste visual de foto">
                <div>
                  <p className="text-sm font-semibold text-[#173b3a]">Ajuste visual</p>
                  <p className="text-xs text-[#637773]">La foto se prepara para el feed en 4:5 (1080 × 1350), sin marcos negros.</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["CLINICAL", "EDUCATIONAL", "COMMERCIAL"] as const).map((preset) => (
                    <button
                      key={preset} type="button" disabled={isPending}
                      aria-pressed={photoPreset === preset}
                      onClick={() => setPhotoPreset(preset)}
                      className={`min-h-10 rounded-lg border px-1 text-xs font-semibold ${photoPreset === preset ? "border-[#176c63] bg-white text-[#176c63]" : "border-[#d7e5df] text-[#637773]"}`}
                    >
                      {preset === "CLINICAL" ? "Clínico" : preset === "EDUCATIONAL" ? "Educativo" : "Comercial"}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs font-medium text-[#46615b]">
                    <span className="block">Encuadre</span>
                    <select value={photoLayout} disabled={isPending}
                      onChange={(event) => setPhotoLayout(event.target.value as typeof photoLayout)}
                      className="w-full rounded-lg border border-[#cbdcd4] bg-white p-2">
                      <option value="AUTO">Automático</option>
                      <option value="CONTAIN">Foto completa</option>
                      <option value="COVER">Rellenar lienzo</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-medium text-[#46615b]">
                    <span className="block">Fondo</span>
                    <select value={photoBackground} disabled={isPending}
                      onChange={(event) => setPhotoBackground(event.target.value as typeof photoBackground)}
                      className="w-full rounded-lg border border-[#cbdcd4] bg-white p-2">
                      <option value="LIGHT">Claro</option>
                      <option value="BLUR">Desenfocado</option>
                    </select>
                  </label>
                </div>
                <details className="text-xs text-[#46615b]">
                  <summary className="cursor-pointer font-medium">Ajustar zoom y posición</summary>
                  <div className="mt-3 space-y-2">
                    <label className="block">Zoom: {photoZoom.toFixed(2)}×
                      <input className="w-full" type="range" min="1" max="1.6" step="0.05" value={photoZoom} disabled={isPending}
                        onChange={(event) => setPhotoZoom(Number(event.target.value))}/>
                    </label>
                    <label className="block">Mover horizontalmente
                      <input className="w-full" type="range" min="-100" max="100" step="10" value={photoOffsetX} disabled={isPending}
                        onChange={(event) => setPhotoOffsetX(Number(event.target.value))}/>
                    </label>
                    <label className="block">Mover verticalmente
                      <input className="w-full" type="range" min="-100" max="100" step="10" value={photoOffsetY} disabled={isPending}
                        onChange={(event) => setPhotoOffsetY(Number(event.target.value))}/>
                    </label>
                  </div>
                </details>
                {selectedPhoto && (
                  <div className="space-y-2">
                    {photoPreview ? (
                      <div className="mx-auto max-w-[280px] overflow-hidden rounded-xl border border-[#d7e5df] bg-white p-2">
                        <p className="mb-2 text-xs font-medium text-[#46615b]">Vista previa para Facebook e Instagram (feed 4:5)</p>
                        <img src={photoPreview} alt="Vista previa del archivo final 4:5" className="aspect-[4/5] w-full object-contain" />
                      </div>
                    ) : <p role="status" className="text-xs">Preparando vista previa…</p>}
                    {photoPreviewError && <p role="alert" className="text-xs text-red-700">{photoPreviewError}</p>}
                    <p className="text-xs text-[#637773]">Previsualización de la imagen final; el recorte que aplique cada red puede variar.</p>
                  </div>
                )}
              </section>
            )}

            {format === "video" && (
              <fieldset className="space-y-3 rounded-xl border border-[#d7e5df] bg-[#f7faf8] p-3">
                <legend className="px-1 text-sm font-semibold text-[#173b3a]">Edición de video</legend>
                <label className="flex items-center gap-3 text-sm text-[#46615b]">
                  <input type="checkbox" name="muteAudio" value="true" disabled={isPending} />
                  Silenciar audio original
                </label>
              </fieldset>
            )}

            {format === "photo" && (
              <label className="flex gap-3 rounded-xl border border-[#d7e5df] bg-[#f7faf8] p-3 text-xs leading-5 text-[#46615b]">
                <input type="checkbox" name="visionConsent" value="true" required disabled={isPending} className="mt-1" />
                <span>
                  <strong className="block text-sm text-[#173b3a]">Grok Vision integrado</strong>
                  Se analizará una versión reducida de la foto. Confirmo que tengo autorización para enviarla a xAI,
                  que no contiene datos identificables y que la revisión clínica será humana.
                </span>
              </label>
            )}

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
                  Grok está preparando el contenido...
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
          onRetry={retryNetwork}
          onVerify={verifyNetwork}
          onLookup={lookupMetaId}
          onChooseStyle={changeCopyStyle}
          onAuthorizeRetry={reconcileRetry}
        />
      </div>
        </div>
      </div>
    </main>
  );
}
