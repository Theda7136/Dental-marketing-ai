"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SourceAsset = { id: string; file: File; url: string; kind: "image" | "video" };
type AdStyle = "premium" | "educativo" | "dinamico";
type AdGoal = "whatsapp" | "confianza" | "educacion";
type Scene = { assetId: string; heading: string; seconds: number };

const treatments = ["Diseño de sonrisa", "Implantes dentales", "Ortodoncia", "Blanqueamiento", "Rehabilitación oral", "Presentación de la clínica"];
const maxFiles = 12;
const maxBytes = 80 * 1024 * 1024;

function classifyFile(file: File): "image" | "video" | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      ["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) return "image";
  if (["video/mp4", "video/quicktime", "video/webm"].includes(file.type) ||
      ["mp4", "mov", "webm"].includes(extension ?? "")) return "video";
  return null;
}

function outlineFor(treatment: string, goal: AdGoal, style: AdStyle) {
  const introduction = style === "educativo"
    ? `Conoce más sobre ${treatment.toLowerCase()}.`
    : style === "dinamico"
      ? `Una nueva manera de hablar de ${treatment.toLowerCase()}.`
      : `Cada sonrisa merece atención personalizada.`;
  const explanation = goal === "educacion"
    ? `Descubre cómo evaluamos cada caso y planificamos el tratamiento según las necesidades de cada paciente.`
    : `En nuestra clínica escuchamos tus objetivos y te explicamos las opciones de tratamiento tras una valoración profesional.`;
  const close = goal === "whatsapp"
    ? "Escríbenos por WhatsApp para solicitar una valoración."
    : goal === "confianza"
      ? "Conoce a nuestro equipo y cómo trabajamos."
      : "Consulta con un profesional qué opciones pueden ser adecuadas para ti.";
  return { introduction, explanation, close };
}

export default function VideoAdStudio() {
  const [treatment, setTreatment] = useState(treatments[0]);
  const [goal, setGoal] = useState<AdGoal>("whatsapp");
  const [style, setStyle] = useState<AdStyle>("premium");
  const [duration, setDuration] = useState(30);
  const [assets, setAssets] = useState<SourceAsset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState(() => outlineFor(treatments[0], "whatsapp", "premium"));
  const fileInput = useRef<HTMLInputElement>(null);
  const assetsRef = useRef<SourceAsset[]>([]);
  const renderedRef = useRef<string | null>(null);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => {
    assetsRef.current.forEach(asset => URL.revokeObjectURL(asset.url));
    if (renderedRef.current) URL.revokeObjectURL(renderedRef.current);
  }, []);

  function clearRender() {
    if (renderedRef.current) URL.revokeObjectURL(renderedRef.current);
    renderedRef.current = null;
    setRenderedUrl(null);
  }

  const active = assets.find(asset => asset.id === activeId) ?? assets[0];
  const assignedSeconds = scenes.reduce((total, scene) => total + scene.seconds, 0);
  const isDraftCurrent = scenes.length > 0 && scenes.every(scene => assets.some(asset => asset.id === scene.assetId));
  const hasEnoughAssets = assets.length > 0;
  const summary = useMemo(() => ({
    goal: goal === "whatsapp" ? "Consultas por WhatsApp" : goal === "confianza" ? "Confianza en la clínica" : "Educación del paciente",
    style: style === "premium" ? "Premium" : style === "educativo" ? "Educativo" : "Dinámico",
  }), [goal, style]);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    if (assets.length + chosen.length > maxFiles) {
      setError(`Puedes usar hasta ${maxFiles} archivos por anuncio.`);
      return;
    }
    if (chosen.some(file => !classifyFile(file) || file.size === 0 || file.size > maxBytes)) {
      setError("Usa JPG, PNG, WebP, MP4, MOV o WebM, hasta 80 MB por archivo.");
      return;
    }
    const added = chosen.map(file => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file), kind: classifyFile(file)!,
    }));
    setAssets(previous => [...previous, ...added]);
    setActiveId(current => current ?? added[0]?.id ?? null);
    setScenes([]);
    clearRender();
    setConsentConfirmed(false);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeAsset(id: string) {
    const selected = assets.find(asset => asset.id === id);
    if (selected) URL.revokeObjectURL(selected.url);
    const remaining = assets.filter(asset => asset.id !== id);
    setAssets(remaining);
    setActiveId(current => current === id ? remaining[0]?.id ?? null : current);
    setScenes([]);
    clearRender();
    setConsentConfirmed(false);
  }

  function moveAsset(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= assets.length) return;
    const ordered = [...assets];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setAssets(ordered);
    setScenes([]);
    clearRender();
  }

  function draftScenes() {
    if (!hasEnoughAssets || !consentConfirmed) {
      setError("Añade material y confirma que tienes autorización para utilizarlo.");
      return;
    }
    const base = Math.floor(duration / assets.length);
    const remainder = duration % assets.length;
    const lines = [copy.introduction, copy.explanation, copy.close];
    setScenes(assets.map((asset, index) => ({
      assetId: asset.id,
      heading: lines[Math.min(2, Math.floor(index * 3 / assets.length))],
      seconds: base + (index < remainder ? 1 : 0),
    })));
    setActiveId(assets[0].id);
    clearRender();
    setError("");
  }

  async function renderAd() {
    if (!isDraftCurrent || rendering || !consentConfirmed || assignedSeconds < 1 || assignedSeconds > 45) return;
    setRendering(true);
    setError("");
    clearRender();

    const form = new FormData();
    form.set("authorized", "true");
    form.set("style", style);
    form.set("manifest", JSON.stringify(scenes.map(scene => {
      const asset = assets.find(source => source.id === scene.assetId)!;
      return { seconds: scene.seconds, heading: scene.heading, kind: asset.kind };
    })));
    scenes.forEach((scene, index) => {
      const asset = assets.find(source => source.id === scene.assetId)!;
      form.set(`file-${index}`, asset.file);
    });

    try {
      const response = await fetch("/api/video-ads/render", { method: "POST", body: form });
      if (!response.ok) {
        const details = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(details?.error ?? "No fue posible crear el video.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("El servidor devolvió un video vacío.");
      const url = URL.createObjectURL(blob);
      renderedRef.current = url;
      setRenderedUrl(url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No fue posible crear el video.");
    } finally {
      setRendering(false);
    }
  }

  function downloadStoryboard() {
    if (!isDraftCurrent) return;
    const lines = [
      "VIDEO AD STUDIO — GUION DE PRODUCCIÓN",
      `Procedimiento: ${treatment}`,
      `Objetivo: ${summary.goal}`,
      `Estilo: ${summary.style}`,
      `Duración solicitada: ${duration} s`,
      `Duración planificada: ${assignedSeconds} s`,
      "",
      "Guion:",
      copy.introduction, copy.explanation, copy.close,
      "",
      ...scenes.map((scene, index) => {
        const source = assets.find(asset => asset.id === scene.assetId);
        return `Escena ${index + 1} — ${scene.seconds} s — ${source?.file.name ?? "Sin archivo"}\n${scene.heading}`;
      }),
      "",
      "Borrador de planificación, no video generado.",
      "Verificar autorización de uso, resultados clínicos y afirmaciones antes de producir o publicar.",
    ];
    const file = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "guion-video-publicitario.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="ad-studio" aria-label="Editor de anuncios en video">
      <div className="ad-studio-header">
        <div>
          <p className="eyebrow">PRODUCCIÓN AUDIOVISUAL</p>
          <h2>Prepara tu próximo anuncio</h2>
          <p>Combina fotografías y clips reales, prepara las escenas y renderiza un MP4 para revisión. No se publica automáticamente.</p>
        </div>
        <span className="ad-studio-phase">Fase 3 · Anuncios visuales</span>
      </div>

      <div className="ad-studio-layout">
        <div className="ad-studio-workspace">
          <div className="ad-studio-panel-heading">
            <div><h3>Vista de material</h3><p>Selecciona un archivo para revisarlo</p></div>
            <span className="studio-preview-format">9:16</span>
          </div>
          <div className="ad-studio-stage">
            {active
              ? active.kind === "image"
                ? <img key={active.id} src={active.url} alt={active.file.name} />
                : <video key={active.id} src={active.url} controls playsInline preload="metadata" aria-label={active.file.name} />
              : <div className="ad-studio-empty"><span aria-hidden="true">▣</span><strong>Tu material aparecerá aquí</strong><p>Agrega fotografías y videos para empezar a construir tu anuncio.</p></div>}
          </div>
          <div className="ad-studio-filmstrip-heading">
            <h3>Secuencia <small>({assets.length}/{maxFiles})</small></h3>
            <button type="button" onClick={() => fileInput.current?.click()}>+ Agregar archivos</button>
          </div>
          <input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple hidden onChange={event => addFiles(event.target.files)} />
          {assets.length > 0 ? (
            <div className="ad-studio-filmstrip">
              {assets.map((asset, index) => (
                <div className={`ad-studio-asset ${active?.id === asset.id ? "is-active" : ""}`} key={asset.id}>
                  <button className="ad-studio-asset-preview" onClick={() => setActiveId(asset.id)} type="button" aria-label={`Ver ${asset.file.name}`}>
                    {asset.kind === "image" ? <img src={asset.url} alt="" /> : <video src={asset.url} muted preload="metadata" />}
                    <span>{index + 1}</span>
                  </button>
                  <p title={asset.file.name}>{asset.file.name}</p>
                  <div className="ad-studio-asset-actions">
                    <button type="button" disabled={index === 0} onClick={() => moveAsset(index, -1)} aria-label={`Mover ${asset.file.name} a la izquierda`}>←</button>
                    <button type="button" disabled={index === assets.length - 1} onClick={() => moveAsset(index, 1)} aria-label={`Mover ${asset.file.name} a la derecha`}>→</button>
                    <button type="button" onClick={() => removeAsset(asset.id)} aria-label={`Quitar ${asset.file.name}`}>×</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <button className="ad-studio-upload" type="button" onClick={() => fileInput.current?.click()}>
              <span aria-hidden="true">＋</span>
              <strong>Seleccionar fotografías o clips</strong>
              <small>JPG, PNG, WebP, MP4, MOV o WebM · hasta {maxFiles} archivos</small>
            </button>
          )}

          {renderedUrl && <div className="ad-studio-rendered"><div className="ad-studio-panel-heading"><div><h3>Video preparado</h3><p>Revisa el MP4 antes de utilizarlo en una campaña.</p></div></div><video src={renderedUrl} controls playsInline preload="metadata" aria-label="Vista previa del video publicitario renderizado" /><a href={renderedUrl} download="video-publicitario.mp4" className="ad-studio-download">Descargar video MP4</a></div>}

          {scenes.length > 0 && (
            <div className="ad-studio-storyboard">
              <div className="ad-studio-panel-heading"><div><h3>Guion por escenas</h3><p>{assignedSeconds} segundos distribuidos entre {scenes.length} escenas</p></div></div>
              {scenes.map((scene, index) => (
                <div className="ad-studio-scene" key={scene.assetId}>
                  <span className="ad-studio-scene-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{assets.find(asset => asset.id === scene.assetId)?.file.name}</strong>
                    <textarea aria-label={`Texto de escena ${index + 1}`} rows={2} value={scene.heading} onChange={event => { clearRender(); setScenes(previous => previous.map((entry, position) => position === index ? { ...entry, heading: event.target.value } : entry)); }} />
                  </div>
                  <label className="ad-studio-scene-duration">Seg.<input type="number" min={1} max={60} value={scene.seconds} onChange={event => { clearRender(); setScenes(previous => previous.map((entry, position) => position === index ? { ...entry, seconds: Math.max(1, Math.min(45, Number(event.target.value) || 1)) } : entry)); }} /></label>
                </div>
              ))}
              {assignedSeconds !== duration && <p className="ad-studio-hint">La duración actual es de {assignedSeconds} s; seleccionaste {duration} s.</p>}
              <div className="ad-studio-render-actions"><button type="button" className="ad-studio-download" onClick={downloadStoryboard}>Descargar guion</button><button type="button" className="ad-studio-primary" disabled={rendering || !consentConfirmed || assignedSeconds > 45} onClick={renderAd}>{rendering ? "Renderizando video..." : "Generar video MP4"}</button></div>
            </div>
          )}
        </div>

        <aside className="ad-studio-settings">
          <div className="ad-studio-panel-heading"><div><h3>Configurar anuncio</h3><p>Define el enfoque de la pieza</p></div></div>
          <label className="ad-studio-field">Procedimiento<select value={treatment} onChange={event => { setTreatment(event.target.value); setScenes([]); clearRender(); }} >{treatments.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="ad-studio-field">Objetivo<select value={goal} onChange={event => { setGoal(event.target.value as AdGoal); setScenes([]); clearRender(); }}><option value="whatsapp">Consultas por WhatsApp</option><option value="confianza">Transmitir confianza</option><option value="educacion">Educación del paciente</option></select></label>
          <div className="ad-studio-field"><span>Estilo visual</span><div className="ad-studio-choices">{(["premium", "educativo", "dinamico"] as const).map(value => <button key={value} type="button" aria-pressed={style === value} onClick={() => { setStyle(value); setScenes([]); clearRender(); }}>{value === "dinamico" ? "Dinámico" : value === "educativo" ? "Educativo" : "Premium"}</button>)}</div></div>
          <div className="ad-studio-field"><span>Duración objetivo</span><div className="ad-studio-choices">{[15,30,45] .map(value => <button key={value} type="button" aria-pressed={duration === value} onClick={() => { setDuration(value); setScenes([]); clearRender(); }}>{value} s</button>)}</div></div>
          <div className="ad-studio-script">
            <h3>Texto de la propuesta</h3>
            <p>Base editorial editable; no es un texto generado por IA.</p>
            <button type="button" className="ad-studio-script-reset" onClick={() => { setCopy(outlineFor(treatment, goal, style)); setScenes([]); clearRender(); }}>Crear texto base</button>
            {(["introduction", "explanation", "close"] as const).map((part,index) => <label className="ad-studio-field" key={part}>{["Apertura","Mensaje principal","Cierre"][index]}<textarea rows={index === 1 ? 3 : 2} value={copy[part]} onChange={event => { setCopy(previous => ({ ...previous, [part]: event.target.value })); setScenes([]); clearRender(); }} /></label>)}
          </div>
          <label className="ad-studio-consent"><input type="checkbox" checked={consentConfirmed} onChange={event => { setConsentConfirmed(event.target.checked); if (!event.target.checked) clearRender(); }} /> <span>Confirmo que tengo autorización para utilizar estos archivos en contenido publicitario y que revisaré cualquier afirmación clínica.</span></label>
          {error && <p role="alert" className="ad-studio-error">{error}</p>}
          <button type="button" className="ad-studio-primary" disabled={!assets.length || !consentConfirmed} onClick={draftScenes}>Preparar storyboard</button>
          <p className="ad-studio-hint">El estilo Premium, Dinámico o Educativo se aplica al MP4. Las imágenes clínicas originales se mantienen intactas. El video se renderiza en el servidor, pero no se guarda ni publica automáticamente.</p>
        </aside>
      </div>
    </section>
  );
}
