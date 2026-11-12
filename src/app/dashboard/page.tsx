"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import {
  ApprovalQueue,
  type ApprovalQueuePost,
} from "../../components/ApprovalQueue";
import { clinicalGuardrails } from "../../config/clinicalGuardrails";
import BrandSettings from "../../components/BrandSettings";
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

type StudioView = "create" | "pending" | "history" | "connections";

export default function DashboardPage({ view = "create" }: { view?: StudioView }) {
  // Limpieza segura de parámetros de URL una sola vez al cargar la página
  useEffect(() => {
    if (window.location.search.includes("success") || window.location.search.includes("error")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const [format, setFormat] = useState<ContentFormat>("photo");
  const [posts, setPosts] = useState<ApprovalQueuePost[]>([]);
  const [brandIdentity, setBrandIdentity] = useState<{
    clinicName: string;
    primaryColor: string;
    logoDataUrl: string | null;
  }>({ clinicName: "Dental Studio", primaryColor: "#116D60", logoDataUrl: null });
  const [fileKey, setFileKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Estados controlados para el formulario
  const [procedureName, setProcedureName] = useState("");
  const [notes, setNotes] = useState("");
  const [copyStyle, setCopyStyle] = useState<"EDUCATIONAL" | "COMMERCIAL">("EDUCATIONAL");
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoOffsetX, setPhotoOffsetX] = useState(0);
  const [photoOffsetY, setPhotoOffsetY] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [savedProposal, setSavedProposal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPreviewError, setPhotoPreviewError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const [isPending, startTransition] = useTransition();
  const hasMedia = Boolean(selectedMedia);
  const canConfigure = format === "text" || hasMedia;

  useEffect(() => {
    if (!selectedMedia) {
      setMediaPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedMedia);
    setMediaPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedMedia]);

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
      body.set("photoLayout", "AUTO");
      body.set("photoBackground", "LIGHT");
      body.set("photoPreset", "CLINICAL");
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
  }, [format, selectedPhoto, photoZoom, photoOffsetX, photoOffsetY]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/brand", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (mounted && payload?.brand) setBrandIdentity(payload.brand);
      })
      .catch(() => { /* The default product identity remains available. */ });

    const onBrandUpdate = (event: Event) => {
      const brand = (event as CustomEvent).detail;
      if (brand) setBrandIdentity(brand);
    };
    window.addEventListener("dental-brand-updated", onBrandUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("dental-brand-updated", onBrandUpdate);
    };
  }, []);

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
    setSavedProposal(false);

    const formData = new FormData(event.currentTarget);
    formData.set("procedureName", procedureName);
    formData.set("notes", notes);
    formData.set("selectedStyle", copyStyle);
    formData.set("photoLayout", "AUTO");
    formData.set("photoBackground", "LIGHT");
    formData.set("photoPreset", "CLINICAL");
    formData.set("photoZoom", String(photoZoom));
    formData.set("photoOffsetX", String(photoOffsetX));
    formData.set("photoOffsetY", String(photoOffsetY));

    startTransition(async () => {
      try {
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
        setSelectedPhoto(null);
        setSelectedMedia(null);
        setFileKey((current) => current + 1);
        setSavedProposal(true);
        setNotice("Propuesta guardada y lista para revisión.");
      } else {
        setErrorMessage(result.message || "No se pudo crear la propuesta.");
      }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "No se pudo conectar con el servidor.");
      }
    });
  }

  function changeFormat(next: ContentFormat) {
    setFormat(next);
    setSelectedPhoto(null);
    setSelectedMedia(null);
    setSavedProposal(false);
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
        <a href="/dashboard/crear" className="studio-identity" aria-label="Volver a Crear contenido">
          <span className="brand-mark" aria-hidden="true" style={{ backgroundColor: brandIdentity.primaryColor }}>
            {brandIdentity.logoDataUrl
              ? <img src={brandIdentity.logoDataUrl} alt="" className="studio-header-logo"/>
              : <svg viewBox="0 0 24 24" fill="none" width="23" height="23" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 4.5c-2.2 0-3.5 1.7-3.5 4.2 0 3.2 1.6 8.2 3 10 .6.8 1.4.6 1.7-.4l1.2-3.8c.2-.7 1.2-.7 1.4 0l1.2 3.8c.3 1 1.1 1.2 1.7.4 1.4-1.8 3-6.8 3-10 0-2.5-1.3-4.2-3.5-4.2-1.3 0-1.8.6-3.1.6S9.3 4.5 8 4.5Z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>}
          </span>
          <span className="studio-identity-copy"><strong>{brandIdentity.clinicName}</strong><small>Marketing clínico</small></span>
        </a>
        <div className="studio-sidebar-label">ESPACIO DE TRABAJO</div>
        <nav className="studio-nav" aria-label="Secciones">
          {([
            { id: "create", href: "/dashboard/crear", label: "Crear contenido" },
            { id: "pending", href: "/dashboard/pendientes", label: "Pendientes" },
            { id: "history", href: "/dashboard/historial", label: "Historial" },
            { id: "connections", href: "/dashboard/conexiones", label: "Conexiones" },
          ] as const).map((destination) => (
            <a
              key={destination.id}
              className={`studio-nav-link ${view === destination.id ? "is-current" : ""}`}
              href={destination.href}
              aria-current={view === destination.id ? "page" : undefined}
            >
              {destination.label}
            </a>
          ))}
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
            <h1>{view === "create" ? "Crear contenido" : view === "pending" ? "Pendientes de revisión" : view === "history" ? "Historial de publicaciones" : "Conexiones"}</h1>
            <p>{view === "create"
              ? "Prepara fotografías, videos e ideas listas para revisar."
              : view === "pending"
                ? "Revisa el material antes de publicarlo."
                : view === "history"
                  ? "Consulta las publicaciones y sus estados por red."
                  : "Administra las cuentas sociales de la clínica."}</p>
          </div>
          {view !== "create" && <a href="/dashboard/crear" className="studio-topbar-link">Nueva propuesta</a>}
        </header>
        <div className="studio-content">
          {view === "connections" && <section id="connected-accounts" aria-label="Canales conectados">
            <AccountConnector />
            <BrandSettings />
          </section>}
      {errorMessage ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
          {errorMessage}
        </p>
      ) : null}

      {notice && (
        <div role="status" className="studio-feedback">
          <span className="studio-feedback-icon" aria-hidden="true">✓</span>
          <div><strong>{savedProposal ? "Propuesta creada" : "Cambios guardados"}</strong><p>{notice}</p></div>
          {savedProposal && <a href="/dashboard/pendientes">Ir a pendientes <span aria-hidden="true">→</span></a>}
        </div>
      )}

      <div className={view === "create" ? "studio-editor-grid" : "studio-single-view"}>
        {view === "create" && <section id="create-content" aria-labelledby="new-case-title" className="app-card studio-form-panel rounded-3xl p-5 sm:p-6">
          <div className="studio-form-intro">
            <h2 id="new-case-title">Nueva propuesta</h2>
            <p>Prepara el contenido para revisión y publicación.</p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
            <div>
            <p className="mb-2 text-sm font-semibold text-[#49645b]">Formato</p>
            <div role="tablist" aria-label="Formato del contenido" className="studio-format-picker grid grid-cols-3 gap-2 p-1.5">
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

            {format !== "text" && (
              <div className="studio-file-field">
                <span className="studio-field-label">{format === "video" ? "Video clínico" : "Fotografía clínica"}</span>
                <input
                  ref={fileInputRef}
                  key={fileKey}
                  name="photo"
                  type="file"
                  accept={format === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"}
                  required
                  disabled={isPending}
                  className="sr-only"
                  aria-label={format === "video" ? "Seleccionar video" : "Seleccionar fotografía"}
                  onChange={(event) => {
                    const media = event.currentTarget.files?.[0] ?? null;
                    setSelectedMedia(media);
                    setShowOriginal(false);
                    setSelectedPhoto(format === "photo" ? media : null);
                    setPhotoZoom(1);
                    setPhotoOffsetX(0);
                    setPhotoOffsetY(0);
                  }}
                />
                {selectedMedia ? (
                  <div className="studio-file-selected">
                    <div className="studio-file-thumb">
                      {mediaPreviewUrl && format === "photo"
                        ? <img src={mediaPreviewUrl} alt="Miniatura de la fotografía seleccionada" />
                        : mediaPreviewUrl && format === "video"
                          ? <video src={mediaPreviewUrl} muted playsInline preload="metadata" aria-label="Miniatura del video seleccionado" />
                          : <span aria-hidden="true">▶</span>}
                    </div>
                    <div className="studio-file-info">
                      <strong title={selectedMedia.name}>{selectedMedia.name}</strong>
                      <span>{(selectedMedia.size / 1024 / 1024).toFixed(2)} MB · {format === "photo" ? "Imagen" : "Video"}</span>
                    </div>
                    <button type="button" className="studio-file-replace" disabled={isPending}
                      onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ""; fileInputRef.current.click(); } }}>
                      Reemplazar
                    </button>
                  </div>
                ) : (
                  <button type="button" className="studio-upload-button" disabled={isPending}
                    onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ""; fileInputRef.current.click(); } }}>
                    <span className="studio-upload-icon" aria-hidden="true">＋</span>
                    <span><strong>{format === "video" ? "Agregar video" : "Agregar fotografía"}</strong>
                    <small>{format === "video" ? "MP4, MOV o WebM" : "JPG, PNG o WebP"}</small></span>
                  </button>
                )}
              </div>
            )}

            {canConfigure && <div className="studio-progressive-content">
              <p className="studio-stage-label">Personaliza tu propuesta</p>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-stone-800">Tipo de mensaje</legend>
              <div className="studio-tone-picker grid grid-cols-2 gap-2 p-1.5">
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

            </div>}

            {format === "video" && hasMedia && (
              <fieldset className="space-y-3 rounded-xl border border-[#d7e5df] bg-[#f7faf8] p-3">
                <legend className="px-1 text-sm font-semibold text-[#173b3a]">Edición de video</legend>
                <label className="flex items-center gap-3 text-sm text-[#46615b]">
                  <input type="checkbox" name="muteAudio" value="true" disabled={isPending} />
                  Silenciar audio original
                </label>
              </fieldset>
            )}

            {format === "photo" && hasMedia && (
              <label className="flex gap-3 rounded-xl border border-[#d7e5df] bg-[#f7faf8] p-3 text-xs leading-5 text-[#46615b]">
                <input type="checkbox" name="visionConsent" value="true" required disabled={isPending} className="mt-1" />
                <span>
                  <strong className="block text-sm text-[#173b3a]">Gemini Vision · autorización necesaria</strong>
                  Se analizará una versión reducida de la foto con Google Gemini. Confirmo que tengo autorización para enviarla a Google,
                  que no contiene datos identificables y que la revisión clínica será humana. En el nivel gratuito, Google puede usar contenido enviado para mejorar sus productos; utiliza solo material de prueba o debidamente autorizado.
                </span>
              </label>
            )}

            {canConfigure && <label className="flex flex-col gap-2 text-sm font-medium text-stone-800">
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
            </label>}

            <button
              type="submit"
              disabled={isPending || (format !== "text" && !hasMedia)}
              className="studio-generate flex min-h-12 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold leading-5 text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  La IA está preparando el contenido...
                </>
              ) : (
                "Generar propuesta"
              )}
            </button>
          </form>
        </section>}
        {view === "create" && (
          <aside className={`studio-preview-panel ${!hasMedia ? "is-empty" : "has-media"}`} aria-label="Previsualización de contenido">
            <div className="studio-preview-heading">
              <div>
                <h2>Vista previa</h2>
                <p>{format === "photo" ? "Imagen para el feed" : format === "video" ? "Video para redes" : "Idea de contenido"}</p>
              </div>
              <span className="studio-preview-format">{format === "photo" ? "4:5" : format === "video" ? "VIDEO" : "TEXTO"}</span>
            </div>
            <div className={`studio-preview-canvas ${format === "photo" && selectedPhoto && photoPreview && !showOriginal && !isPending ? "is-adjustable" : ""}`} aria-live="polite"
              onPointerDown={(event) => {
                if (format !== "photo" || !selectedPhoto || isPending || showOriginal) return;
                if (event.button !== 0 || !photoPreview) return;
                dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: photoOffsetX, offsetY: photoOffsetY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const origin = dragStart.current;
                if (!origin || origin.pointerId !== event.pointerId || format !== "photo" || showOriginal) return;
                const frame = event.currentTarget.getBoundingClientRect();
                if (!frame.width || !frame.height) return;
                setPhotoOffsetX(Math.max(-100, Math.min(100, Math.round(origin.offsetX + (event.clientX - origin.x) / frame.width * 180))));
                setPhotoOffsetY(Math.max(-100, Math.min(100, Math.round(origin.offsetY + (event.clientY - origin.y) / frame.height * 180))));
              }}
              onPointerUp={(event) => {
                if (dragStart.current?.pointerId !== event.pointerId) return;
                dragStart.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { dragStart.current = null; }}
              onLostPointerCapture={() => { dragStart.current = null; }}
            >
              {format === "video" && mediaPreviewUrl ? (
                <video key={mediaPreviewUrl} src={mediaPreviewUrl} controls playsInline preload="metadata"
                  className="studio-preview-video" aria-label="Reproducción local del video seleccionado" />
              ) : format === "photo" && (showOriginal ? mediaPreviewUrl : photoPreview) ? (
                <img src={(showOriginal ? mediaPreviewUrl : photoPreview)!} alt={showOriginal ? "Fotografía original seleccionada" : "Previsualización de la fotografía procesada para el feed"} className="studio-preview-image" draggable={false} />
              ) : (
                <div className="studio-preview-placeholder">
                  <svg width="42" height="42" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <rect x="7" y="9" width="34" height="30" rx="4" />
                    <circle cx="19" cy="20" r="3.2" />
                    <path d="m11 34 10-10 7 7 6-6 4 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <strong>{format === "photo" ? "Tu fotografía aparecerá aquí" : format === "video" ? "Prepara tu video" : "Prepara tu guion"}</strong>
                  <span>{format === "photo" && selectedPhoto && !photoPreviewError ? "Procesando vista previa…" : format === "photo" ? "Selecciona una fotografía para visualizar el encuadre." : format === "video" ? "Selecciona un video para generar una propuesta." : "Selecciona un procedimiento y describe tu idea."}</span>
                </div>
              )}
            </div>
            {format === "photo" && selectedPhoto && (
              <div className="studio-image-controls" aria-label="Ajustar encuadre de la fotografía">
                <div className="studio-image-toolbar">
                  <strong>Encuadre <small>{showOriginal ? "Original" : "Arrastra para mover · 4:5"}</small></strong>
                  <div className="studio-image-toolbar-actions">
                    <button type="button" onClick={() => setShowOriginal((current) => !current)} disabled={isPending}>{showOriginal ? "Ver resultado" : "Ver original"}</button>
                    <button type="button" onClick={() => { setPhotoZoom(1); setPhotoOffsetX(0); setPhotoOffsetY(0); setShowOriginal(false); }} disabled={isPending}>Restablecer</button>
                  </div>
                </div>
                <div className="studio-zoom-toolbar">
                  <span>Zoom</span>
                  <button type="button" aria-label="Reducir zoom" disabled={isPending || showOriginal || photoZoom <= 1}
                    onClick={() => setPhotoZoom((z) => Math.max(1, Math.round((z - .05) * 100) / 100))}>−</button>
                  <input type="range" aria-label="Zoom de fotografía" min="1" max="1.6" step="0.05" value={photoZoom}
                    disabled={isPending || showOriginal} onChange={(event) => setPhotoZoom(Number(event.target.value))}/>
                  <button type="button" aria-label="Aumentar zoom" disabled={isPending || showOriginal || photoZoom >= 1.6}
                    onClick={() => setPhotoZoom((z) => Math.min(1.6, Math.round((z + .05) * 100) / 100))}>+</button>
                  <output>{photoZoom.toFixed(2)}×</output>
                </div>
              </div>
            )}
            {photoPreviewError && <p role="alert" className="studio-preview-error">{photoPreviewError}</p>}
            <p className="studio-preview-caption">{format === "photo" ? "Arrastra la fotografía para moverla. Ajusta el zoom antes de generar." : "La propuesta se guardará para revisión antes de publicarse."}</p>
          </aside>
        )}

        {(view === "pending" || view === "history") && <ApprovalQueue
          posts={posts}
          onApprove={approvePost}
          onEdit={handleEditPost}
          onRetry={retryNetwork}
          onVerify={verifyNetwork}
          onLookup={lookupMetaId}
          onChooseStyle={changeCopyStyle}
          onAuthorizeRetry={reconcileRetry}
        />}
      </div>
        </div>
      </div>
    </main>
  );
}
