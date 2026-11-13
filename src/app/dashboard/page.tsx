"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import {
  ApprovalQueue,
  type ApprovalQueuePost,
} from "../../components/ApprovalQueue";
import { clinicalGuardrails } from "../../config/clinicalGuardrails";
import BrandSettings from "../../components/BrandSettings";
import { AccountConnector } from "../../components/AccountConnector";
import { EditorialCalendar } from "../../components/EditorialCalendar";
import { ClinicTeam } from "../../components/ClinicTeam";
import { createTextProposal, recordDeliveryReview, retryPendingNetwork, updatePendingCaption, verifyMetaObject, chooseCopyStyle, authorizeManualRetry, publishSelectedNetworks, type PublishNetwork } from "./actions";

type ContentFormat = "photo" | "video" | "text";

type DeliveryFormat = "FEED" | "REEL" | "STORY";

const DESTINATIONS: { id: DeliveryFormat; label: string; description: string }[] = [
  { id: "FEED", label: "Publicación", description: "Feed 4:5" },
  { id: "REEL", label: "Reel", description: "Video 9:16" },
  { id: "STORY", label: "Historia", description: "Estado 9:16" },
];

function mediaFormat(file: File): "photo" | "video" | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) || ["jpg", "jpeg", "png", "webp"].includes(extension || "")) return "photo";
  if (["video/mp4", "video/quicktime", "video/webm"].includes(file.type) || ["mp4", "mov", "webm"].includes(extension || "")) return "video";
  return null;
}

type StudioView = "create" | "pending" | "history" | "calendar" | "connections" | "team";

export default function DashboardPage({ view = "create" }: { view?: StudioView }) {
  useEffect(() => {
    fetch("/api/studio/me", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(profile => setCurrentRole(profile?.role ?? null))
      .catch(() => setCurrentRole(null));
  }, []);

  // Limpieza segura de parámetros de URL una sola vez al cargar la página
  useEffect(() => {
    if (window.location.search.includes("success") || window.location.search.includes("error")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const [format, setFormat] = useState<ContentFormat>("photo");
  const [deliveryFormat, setDeliveryFormat] = useState<"FEED" | "REEL" | "STORY">("FEED");
  const [posts, setPosts] = useState<ApprovalQueuePost[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
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
    formData.set("deliveryFormat", deliveryFormat);
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
        window.location.assign("/dashboard/pendientes");
      } else {
        setErrorMessage(result.message || "No se pudo crear la propuesta.");
      }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "No se pudo conectar con el servidor.");
      }
    });
  }

  function toggleScriptMode() {
    setFormat((current) => current === "text" ? "photo" : "text");
    setDeliveryFormat("FEED");
    setSelectedPhoto(null);
    setSelectedMedia(null);
    setShowOriginal(false);
    setPhotoZoom(1);
    setPhotoOffsetX(0);
    setPhotoOffsetY(0);
    setSavedProposal(false);
    setFileKey((current) => current + 1);
  }

  function selectMedia(file: File | null) {
    if (!file) {
      setSelectedMedia(null);
      setSelectedPhoto(null);
      return;
    }

    const detected = mediaFormat(file);
    if (!detected) {
      setErrorMessage("Selecciona una foto JPG, PNG o WebP, o un video MP4, MOV o WebM.");
      setSelectedMedia(null);
      setSelectedPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const sizeLimit = detected === "photo" ? 20 : 80;
    if (file.size > sizeLimit * 1024 * 1024) {
      setErrorMessage(`El archivo supera el límite de ${sizeLimit} MB para ${detected === "photo" ? "fotografías" : "videos"}.`);
      setSelectedMedia(null);
      setSelectedPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setErrorMessage(null);
    setFormat(detected);
    setSelectedMedia(file);
    setSelectedPhoto(detected === "photo" ? file : null);
    setDeliveryFormat((current) => detected === "video" && current === "FEED" ? "REEL" : current);
    setShowOriginal(false);
    setPhotoZoom(1);
    setPhotoOffsetX(0);
    setPhotoOffsetY(0);
  }

  // Manejador para aprobar y publicar directamente en Instagram y Facebook
  async function reloadPosts() {
    const response = await fetch("/api/posts", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudieron actualizar los estados de publicación.");
    const payload = await response.json() as { posts: ApprovalQueuePost[] };
    setPosts(payload.posts);
  }

  async function publishNetworks(
    postId: string,
    networks: PublishNetwork[],
    tiktok?: { privacy: string; disableComment: boolean; disableDuet: boolean; disableStitch: boolean },
  ) {
    setErrorMessage(null);
    setNotice(null);
    const outcome = await publishSelectedNetworks(postId, networks, tiktok);
    setNotice(outcome.message);
    return outcome;
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
        ? { ...post, selectedStyle: style, generatedCaption: chosen.caption!, clinicalVerifiedAt: null }
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

  async function deletePost(postId: string) {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const payload = await response.json() as { ok?: boolean; message?: string };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "No se pudo retirar la publicación.");
    }

    setPosts((current) => current.filter((post) => post.id !== postId));
    setNotice(payload.message || "Publicación retirada de la lista.");
  }

  async function handleEditPost(post: ApprovalQueuePost, caption: string) {
    const revised = await updatePendingCaption(post.id, caption);
    if (!revised.ok || !revised.caption) {
      throw new Error(revised.message || "No se pudo actualizar la propuesta.");
    }

    setPosts((current) => current.map((savedPost) =>
      savedPost.id === post.id
        ? { ...savedPost, generatedCaption: revised.caption!, clinicalVerifiedAt: null }
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
             { id: "calendar", href: "/dashboard/calendario", label: "Calendario" },
             { id: "connections", href: "/dashboard/conexiones", label: "Conexiones" },
             { id: "team", href: "/dashboard/equipo", label: "Equipo" },
           ] as const).filter(destination => {
             if (destination.id === "create") return currentRole !== "REVIEWER";
             if (destination.id === "connections" || destination.id === "team") return currentRole === "OWNER" || currentRole === "ADMIN";
             return true;
           }).map((destination) => (
             <a key={destination.id}
               className={`studio-nav-link ${view === destination.id ? "is-current" : ""}`}
               href={destination.href}
               aria-current={view === destination.id ? "page" : undefined}>
               <svg viewBox="0 0 24 24" aria-hidden="true" className="studio-nav-icon" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                 {destination.id === "create" ? <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7v10M7 12h10"/></>
                   : destination.id === "pending" ? <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M9 10h4"/></>
                   : destination.id === "history" ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>
                   : <><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/><circle cx="10" cy="17" r="2" fill="white"/></>}
               </svg>
               <span>{destination.label}</span>
               {destination.id === "pending" && posts.some((post) => post.status === "PENDING_APPROVAL") && (
                 <span className="studio-nav-count">{posts.filter((post) => post.status === "PENDING_APPROVAL").length}</span>
               )}
             </a>
           ))}
         </nav>
        <div className="studio-sidebar-footer">
          <button type="button" onClick={async () => {
            const response = await fetch("/api/studio/logout", { method: "POST" });
            if (response.ok) window.location.assign("/login");
          }} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-100">
            Cerrar sesión
          </button>
          <span className="studio-availability"><span className="studio-availability-dot" /> Espacio de clínica piloto</span>
          <p>Todo contenido requiere revisión antes de publicarse.</p>
        </div>
      </aside>
      <div className="studio-main" id="studio-main">
        <header className="studio-topbar">
          <div>
            <p className="eyebrow">{view === "create" ? "ESTUDIO CREATIVO" : view === "pending" ? "FLUJO DE REVISIÓN" : "DENTAL STUDIO"}</p>
            <h1>{view === "create" ? "Crear contenido" : view === "pending" ? "Pendientes de revisión" : view === "history" ? "Historial de publicaciones" : view === "calendar" ? "Calendario editorial" : view === "team" ? "Equipo y permisos" : "Conexiones"}</h1>
            <p>{view === "create"
              ? "Prepara fotografías, videos e ideas listas para revisar."
              : view === "pending"
                ? "Revisa el material antes de publicarlo."
                : view === "history"
                  ? "Consulta las publicaciones y sus estados por red."
                  : view === "calendar"
                    ? "Organiza el contenido de la clínica con fechas y horarios."
                    : view === "team" ? "Invita usuarios y controla sus permisos." : "Administra las cuentas sociales de la clínica."}</p>
          </div>
          <div className="studio-topbar-actions">{view === "create" ? <a href="/dashboard/pendientes" className="studio-topbar-link">Ver pendientes <span aria-hidden="true">↗</span></a> : <a href="/dashboard/crear" className="studio-topbar-link"><span aria-hidden="true">＋</span> Nueva propuesta</a>}</div>
        </header>
        <div className="studio-content">
          {view === "calendar" && <EditorialCalendar posts={posts} onReload={reloadPosts} />}
          {view === "team" && <ClinicTeam />}
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
            <span className="studio-section-kicker">01 / CONFIGURACIÓN</span>
             <h2 id="new-case-title">Nueva propuesta</h2>
            <p>Prepara el contenido para revisión y publicación.</p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#49645b]">{format === "text" ? "Modo guion" : "Archivo de contenido"}</p>
              <button type="button" onClick={toggleScriptMode} disabled={isPending}
                className="rounded-lg border border-[#cbded4] bg-white px-3 py-2 text-xs font-semibold text-[#176c63] transition hover:bg-[#edf6f1] disabled:opacity-60">
                {format === "text" ? "Volver a multimedia" : "Crear guion sin archivo"}
              </button>
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
              <div className="studio-file-field"
                onDragOver={(event) => { if (!isPending) event.preventDefault(); }}
                onDrop={(event) => {
                  if (isPending) return;
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (!file) return;
                  selectMedia(file);
                  if (!fileInputRef.current) return;
                  const mediaKind = mediaFormat(file);
                  const maxBytes = mediaKind === "photo" ? 20 * 1024 * 1024 : 80 * 1024 * 1024;
                  const transfer = new DataTransfer();
                  if (mediaKind && file.size <= maxBytes) transfer.items.add(file);
                  fileInputRef.current.files = transfer.files;
                }}>
                <span className="studio-field-label">Fotografía o video</span>
                <input
                  ref={fileInputRef}
                  key={fileKey}
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                  required
                  disabled={isPending}
                  className="sr-only"
                  aria-label="Seleccionar fotografía o video"
                  onChange={(event) => {
                    selectMedia(event.currentTarget.files?.[0] ?? null);
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
                    <span><strong>Agregar o arrastrar fotografía o video</strong>
                    <small>JPG, PNG, WebP, MP4, MOV o WebM</small></span>
                  </button>
                )}
              </div>
            )}

            {format !== "text" && (
              <fieldset className="space-y-2">
                <legend className="studio-field-label">¿Qué quieres crear?</legend>
                <div className="grid grid-cols-3 gap-2">
                  {DESTINATIONS.map((destination) => {
                    const unsupported = format === "video" && destination.id === "FEED";
                    return (
                      <button key={destination.id} type="button"
                        aria-pressed={deliveryFormat === destination.id}
                        disabled={isPending || unsupported}
                        onClick={() => setDeliveryFormat(destination.id)}
                        className={`flex min-h-[66px] flex-col items-center justify-center rounded-xl border px-2 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${deliveryFormat === destination.id
                          ? "border-[#87b6a8] bg-[#edf6f1] text-[#176c63] shadow-sm"
                          : "border-[#d9e5df] bg-white text-[#667d73] hover:bg-[#f8faf8]"}`}>
                        <span>{destination.label}</span>
                        <small className="mt-1 text-[11px] font-normal">{destination.description}</small>
                      </button>
                    );
                  })}
                </div>
                {format === "video" && (
                  <p className="text-xs leading-5 text-[#607970]">Detectamos un video. Puedes crear un Reel o una Historia vertical.</p>
                )}
                {deliveryFormat === "REEL" && format === "photo" && hasMedia && (
                  <p className="text-xs leading-5 text-[#607970]">Convertiremos la fotografía en un Reel vertical silencioso de 7 segundos.</p>
                )}
                {deliveryFormat === "STORY" && (
                  <p className="text-xs leading-5 text-[#607970]">Las Historias se publican por ahora únicamente en Instagram.</p>
                )}
              </fieldset>
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
              <label className="studio-vision-consent">
                <input type="checkbox" name="visionConsent" value="true" required disabled={isPending} />
                <span>Autorizo el análisis de esta fotografía con Gemini Vision. Confirmo que tengo permiso y que no contiene datos identificables.</span>
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
              className="studio-generate studio-generate-sticky flex min-h-12 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold leading-5 text-white disabled:cursor-not-allowed disabled:opacity-60"
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
                <span className="studio-section-kicker">02 / COMPOSICIÓN</span>
                 <h2>Vista previa</h2>
                <p>{format === "photo" ? (deliveryFormat === "FEED" ? "Imagen para el feed" : deliveryFormat === "REEL" ? "Imagen para Reel" : "Historia vertical") : format === "video" ? (deliveryFormat === "STORY" ? "Historia vertical" : "Reel vertical") : "Idea de contenido"}</p>
              </div>
              <span className="studio-preview-format">{format === "photo" ? (deliveryFormat === "FEED" ? "4:5" : "9:16") : format === "video" ? "9:16" : "TEXTO"}</span>
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
            {photoPreviewError && <p role="alert" className="studio-preview-error">{photoPreviewError}</p>}
            <p className="studio-preview-caption">{format === "photo" && hasMedia ? (deliveryFormat === "FEED" ? "Vista de composición · formato 4:5 sin recortar información clínica." : "Vista de la imagen base. La salida final será vertical 9:16 y se guardará en Pendientes.") : format === "photo" ? "Selecciona una fotografía para ajustar su encuadre." : "La propuesta se guardará para revisión antes de publicarse."}</p>
          </aside>
        )}

        {(view === "pending" || view === "history") && <ApprovalQueue
          posts={posts}
          onPublishSelected={publishNetworks}
          onReload={reloadPosts}
          onDelete={deletePost}
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
