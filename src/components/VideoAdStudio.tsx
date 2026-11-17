"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SourceAsset = { id: string; file: File; url: string; kind: "image" | "video" };
type AdStyle = "premium" | "educativo" | "dinamico";
type AdGoal = "whatsapp" | "confianza" | "educacion";
type Scene = { assetId: string; heading: string; seconds: number };
type AdVariant = { tone: "educativa" | "emocional" | "comercial"; title: string; opening: string; message: string; closing: string; scenes: string[] };

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

async function prepareVisionJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la fotografía.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo convertir la fotografía.")), "image/jpeg", 0.75)
    );
    if (jpeg.size > 2 * 1024 * 1024) throw new Error("La fotografía optimizada supera 2 MB.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}

async function prepareVideoFrame(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("No se pudo abrir el clip para analizarlo."));
      video.src = url;
    });
    const position = Math.min(1, Math.max(0, video.duration / 2));
    if (position > 0) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("No se pudo obtener una imagen del clip."));
        video.currentTime = position;
      });
    }
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar el fotograma.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo extraer el fotograma.")), "image/jpeg", 0.75)
    );
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export default function VideoAdStudio() {
  const [treatment, setTreatment] = useState(treatments[0]);
  const [goal, setGoal] = useState<AdGoal>("whatsapp");
  const [style, setStyle] = useState<AdStyle>("premium");
  const [duration, setDuration] = useState(30);
  const [assets, setAssets] = useState<SourceAsset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [visionConsent, setVisionConsent] = useState(false);
  const [visualCache, setVisualCache] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [narrationEnabled, setNarrationEnabled] = useState(false);

  const [narrationVoice, setNarrationVoice] = useState("Kore");
  const [narrationProvider, setNarrationProvider] = useState<"gemini" | "elevenlabs">("elevenlabs");
  const [captionFont, setCaptionFont] = useState("arial");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState(18);
  const [generatingScripts, setGeneratingScripts] = useState(false);
  const [variants, setVariants] = useState<AdVariant[]>([]);
  const [selectedTone, setSelectedTone] = useState<AdVariant["tone"] | null>(null);
  const [clinicContext, setClinicContext] = useState("");
  const [scriptError, setScriptError] = useState("");
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
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
  const finalSeconds = assignedSeconds + 6;
  const isDraftCurrent = scenes.length > 0 && scenes.every(scene => assets.some(asset => asset.id === scene.assetId));
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
    setVariants([]);
    setSelectedTone(null);
    clearRender();
    setVisionConsent(false);
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
    setVariants([]);
    setSelectedTone(null);
    clearRender();
    setVisualCache(previous => { const next = { ...previous }; delete next[id]; return next; });
  }

  function moveAsset(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= assets.length) return;
    const ordered = [...assets];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setAssets(ordered);
    setScenes([]);
    setVariants([]);
    setSelectedTone(null);
    clearRender();
  }

  async function generateScripts() {
    if (!assets.length || generatingScripts) return;
    if (!visionConsent) { setScriptError("Autoriza el análisis visual con Gemini antes de generar guiones."); return; }
    setGeneratingScripts(true);
    setError("");
    setScriptError("");
    try {
      const observations: string[] = [];
      const updatedCache = { ...visualCache };
      for (const asset of assets) {
        if (!updatedCache[asset.id]) {
          const form = new FormData();
          form.set("consent", "true");
          form.set("image", asset.kind === "image" ? await prepareVisionJpeg(asset.file) : await prepareVideoFrame(asset.file), "vision.jpg");
          const visionResponse = await fetch("/api/video-ads/vision", { method: "POST", body: form });
          const visionPayload = await visionResponse.json() as { description?: string; error?: string };
          if (!visionResponse.ok || !visionPayload.description) throw new Error(visionPayload.error ?? "No se pudo analizar la fotografía.");
          updatedCache[asset.id] = visionPayload.description;
          setVisualCache({ ...updatedCache });
        }
        observations.push(updatedCache[asset.id]);
      }
      const response = await fetch("/api/video-ads/scripts", {
        method: "POST",
        signal: AbortSignal.timeout(32000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          procedure: treatment, goal, duration, sceneCount: assets.length, clinicContext, visualDescriptions: observations,
        }),
      });
      const payload = await response.json() as { variants?: AdVariant[]; error?: string };
      if (!response.ok || !payload.variants) {
        throw new Error(payload.error ?? "No se pudieron generar los guiones.");
      }
      setVariants(payload.variants);
      const preferred = payload.variants.find(variant => variant.tone === "educativa") ?? payload.variants[0];
      if (preferred) useVariant(preferred);
      else {
        setSelectedTone(null);
        setScenes([]);
        clearRender();
      }
    } catch (failure) {
      const message = failure instanceof Error && failure.name === "TimeoutError"
        ? "Gemini tardó demasiado. Vuelve a generar los guiones."
        : failure instanceof Error ? failure.message : "No se pudieron generar los guiones.";
      setScriptError(message);
    } finally {
      setGeneratingScripts(false);
    }
  }

  function useVariant(variant: AdVariant) {
    setSelectedTone(variant.tone);
    if (assets.length === variant.scenes.length) {
      const base = Math.floor(duration / assets.length);
      const remainder = duration % assets.length;
      setScenes(assets.map((asset, index) => ({
        assetId: asset.id,
        heading: variant.scenes[index],
        seconds: base + (index < remainder ? 1 : 0),
      })));
    } else {
      setScenes([]);
    }
    clearRender();
  }

  async function renderAd() {
    if (!isDraftCurrent || rendering || !visionConsent || assignedSeconds < 1 || finalSeconds > 60) return;
    if (scenes.length === 1 && assignedSeconds > 30) { setError("Para un anuncio de 60 segundos agrega más fotografías o clips."); return; }
    setRendering(true);
    setError("");
    clearRender();

    const form = new FormData();
    form.set("authorized", "true");
    form.set("style", style);
    form.set("voice", narrationVoice);
    form.set("narrationProvider", narrationProvider);
    form.set("captionFont", captionFont);
    form.set("narration", String(narrationEnabled));
    form.set("includeClosing", "true");
    const chosenVariant = variants.find(variant => variant.tone === selectedTone);
    form.set("closingText", chosenVariant?.closing || (goal === "whatsapp" ? "Transforma tu sonrisa. Contáctanos por WhatsApp." : "Agenda una valoración y conoce tus opciones."));
    if (musicFile) {
      form.set("music", musicFile);
      form.set("musicVolume", String(musicVolume / 100));
    }
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
      `Variante: ${selectedTone ?? "Sin seleccionar"}`,
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
        <span className="ad-studio-phase">Fase 4 · Guiones IA</span>
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
                  <label className="ad-studio-scene-duration">Seg.<input type="number" min={1} max={60} value={scene.seconds} onChange={event => { clearRender(); setScenes(previous => previous.map((entry, position) => position === index ? { ...entry, seconds: Math.max(1, Math.min(60, Number(event.target.value) || 1)) } : entry)); }} /></label>
                </div>
              ))}
              {scenes.length === 1 && duration === 60 && <p className="ad-studio-hint">Para 60 segundos añade al menos otra fotografía o un clip; una sola escena no es suficiente.</p>}
              {assignedSeconds !== duration && <p className="ad-studio-hint">La duración actual es de {assignedSeconds} s; seleccionaste {duration} s.</p>}
              <div className="ad-studio-render-actions"><button type="button" className="ad-studio-download" onClick={downloadStoryboard}>Descargar guion</button><button type="button" className="ad-studio-primary" disabled={rendering || !visionConsent || finalSeconds > 60} onClick={renderAd}>{rendering ? "Renderizando video..." : "Generar video MP4"}</button></div>
            </div>
          )}
        </div>

        <aside className="ad-studio-settings">
          <div className="ad-studio-panel-heading"><div><h3>Configurar anuncio</h3><p>Define el enfoque de la pieza</p></div></div>
          <label className="ad-studio-field">Procedimiento<select value={treatment} onChange={event => { setTreatment(event.target.value); setVariants([]); setSelectedTone(null); setScenes([]); clearRender(); }} >{treatments.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="ad-studio-field">Objetivo<select value={goal} onChange={event => { setGoal(event.target.value as AdGoal); setVariants([]); setSelectedTone(null); setScenes([]); clearRender(); }}><option value="whatsapp">Consultas por WhatsApp</option><option value="confianza">Transmitir confianza</option><option value="educacion">Educación del paciente</option></select></label>
          <label className="ad-studio-field">Fuente de subtítulos
            <select value={captionFont} onChange={event => { setCaptionFont(event.target.value); clearRender(); }}>
              <option value="arial">Arial · Moderna</option>
              <option value="georgia">Georgia · Elegante</option>
              <option value="verdana">Verdana · Clara</option>
              <option value="trebuchet">Trebuchet · Cercana</option>
            </select>
          </label>
          <div className="ad-studio-field"><span>Estilo visual</span><div className="ad-studio-choices">{(["premium", "educativo", "dinamico"] as const).map(value => <button key={value} type="button" aria-pressed={style === value} onClick={() => { setStyle(value); clearRender(); }}>{value === "dinamico" ? "Dinámico" : value === "educativo" ? "Educativo" : "Premium"}</button>)}</div></div>
          <div className="ad-studio-field">
            <span>Música de fondo (opcional)</span>
            <label htmlFor="ad-music-file" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", alignSelf: "flex-start", padding: "11px 16px", border: "1px solid #91c5b4", borderRadius: 10, color: "#116d60", fontWeight: 700, cursor: "pointer" }}>Seleccionar música MP3, WAV o M4A</label>
            <input ref={musicInput} id="ad-music-file" type="file" style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }} accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" onChange={event => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > 12 * 1024 * 1024) {
                setError("La música no puede superar 12 MB.");
                event.target.value = "";
                return;
              }
              setMusicFile(selected);
              clearRender();
            }} />
            {musicFile && <>
              <span>{musicFile.name}</span>
              <label htmlFor="ad-music-volume">Volumen de música: {musicVolume}%</label>
              <input id="ad-music-volume" type="range" min="5" max="50" step="1" value={musicVolume} onChange={event => { setMusicVolume(Number(event.target.value)); clearRender(); }} />
              <button type="button" onClick={() => { setMusicFile(null); if (musicInput.current) musicInput.current.value = ""; clearRender(); }}>Quitar música</button>
            </>}
            <small>Usa una pista con licencia comercial. Si activas la narración, la música baja de volumen automáticamente.</small>
          </div>
          <div className="ad-studio-field"><span>Duración objetivo</span><div className="ad-studio-choices">{[15,30,60].map(value => <button key={value} type="button" aria-pressed={duration === value} onClick={() => { setDuration(value); setScenes(previous => previous.map((scene, index) => ({ ...scene, seconds: Math.floor(value / previous.length) + (index < value % previous.length ? 1 : 0) }))); clearRender(); }}>{value} s</button>)}</div></div>
          <div className="ad-studio-script">
            <h3>Guiones con Gemini</h3>
            <p>Gemini analizará fotografías y un fotograma representativo de cada video para adaptar los subtítulos. No incluyas datos personales en las notas.</p>
            <label className="ad-studio-field">Información confirmada de la clínica (opcional)<textarea rows={3} maxLength={600} placeholder="Ej.: ofrecemos valoración inicial. No incluyas datos personales." value={clinicContext} onChange={event => setClinicContext(event.target.value)} /></label>
            <label className="ad-studio-consent"><input type="checkbox" checked={visionConsent} onChange={event => { setVisionConsent(event.target.checked); setVariants([]); setSelectedTone(null); }} /> <span>Confirmo que tengo autorización para analizar con Gemini las fotografías y fotogramas de los videos, y para utilizarlos en publicidad.</span></label>
            <label className="ad-studio-consent"><input type="checkbox" checked={narrationEnabled} onChange={event => { setNarrationEnabled(event.target.checked); clearRender(); }} /> <span>Narración con IA. ElevenLabs ofrece voces más naturales; requiere una cuenta y créditos disponibles.</span></label>
            {narrationEnabled && <label className="ad-studio-field">Motor de narración
              <select value={narrationProvider} onChange={event => { setNarrationProvider(event.target.value as "gemini" | "elevenlabs"); clearRender(); }}>
                <option value="elevenlabs">ElevenLabs · Voz natural</option>
                <option value="gemini">Gemini · Voz alternativa</option>
              </select>
            </label>}
            {narrationEnabled && narrationProvider === "gemini" && <label className="ad-studio-field">Voz de la narración
              <select value={narrationVoice} onChange={event => { setNarrationVoice(event.target.value); clearRender(); }}>
                <option value="Kore">Kore · Serena</option>
                <option value="Puck">Puck · Animada</option>
                <option value="Charon">Charon · Profunda</option>
              </select>
            </label>}

            <button type="button" className="ad-studio-primary" disabled={generatingScripts || assets.length === 0 || !visionConsent} onClick={generateScripts}>{generatingScripts ? "Consultando Gemini..." : "Generar 3 guiones con IA"}</button>
            {generatingScripts && <p role="status" className="ad-studio-hint">Preparando tres variantes y sus subtítulos por fotografía.</p>}
            {scriptError && <p role="alert" className="ad-studio-error">{scriptError}</p> }
            {variants.length > 0 && (
              <div className="ad-studio-variants" aria-label="Versiones creativas">
                {variants.map(variant => (
                  <button type="button" key={variant.tone} aria-pressed={selectedTone === variant.tone} onClick={() => useVariant(variant)}>
                    <strong>{variant.tone === "educativa" ? "Educativa" : variant.tone === "emocional" ? "Emocional" : "Comercial"}</strong>
                    <span>{variant.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {error && <p role="alert" className="ad-studio-error">{error}</p>}
          <p className="ad-studio-hint">El estilo Premium, Dinámico o Educativo se aplica al MP4. Las imágenes clínicas originales se mantienen intactas. El video se renderiza en el servidor, pero no se guarda ni publica automáticamente.</p>
        </aside>
      </div>
    </section>
  );
}
