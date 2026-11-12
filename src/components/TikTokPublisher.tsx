"use client";

import { useState } from "react";

type Info = { nickname?: string; username?: string; privacyOptions: string[]; commentsDisabled?: boolean; duetDisabled?: boolean; stitchDisabled?: boolean };
const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Público",
  MUTUAL_FOLLOW_FRIENDS: "Amigos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Solo yo",
};

export function TikTokPublisher({
  postId,
  mediaKind,
  status = "PENDING",
}: {
  postId: string;
  mediaKind?: "image" | "video" | "text";
  status?: string;
}) {
  const [creator, setCreator] = useState<Info | null>(null);
  const [privacy, setPrivacy] = useState("");
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);
  const [message, setMessage] = useState("");

  async function prepare() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tiktok/creator", { cache: "no-store" });
      const info = await response.json();
      if (!response.ok) throw new Error(info.error || "No se pudo consultar TikTok.");
      setCreator(info);
      setPrivacy("");
      setDisableComment(Boolean(info.commentsDisabled));
      setDisableDuet(Boolean(info.duetDisabled));
      setDisableStitch(Boolean(info.stitchDisabled));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar TikTok.");
    } finally { setBusy(false); }
  }

  async function send() {
    if (!privacy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tiktok/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, privacy, disableComment, disableDuet, disableStitch }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo iniciar el envío.");
      setLocalStatus("PROCESSING");
      setCreator(null);
      setMessage("TikTok está procesando el envío. Comprueba su resultado antes de publicarlo otra vez.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar a TikTok.");
    } finally { setBusy(false); }
  }

  async function checkStatus() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tiktok/publish?postId=${encodeURIComponent(postId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo comprobar TikTok.");
      setLocalStatus(payload.status);
      if (payload.status === "SUCCEEDED") {
        window.location.assign("/dashboard/historial");
        return;
      }
      setMessage(payload.status === "SUCCEEDED" ? "TikTok confirmó la publicación."
        : payload.status === "FAILED" ? "TikTok rechazó el envío. " + (payload.message || "")
        : "TikTok sigue procesando el contenido.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo consultar TikTok.");
    } finally { setBusy(false); }
  }

  if (mediaKind === "text") return null;

  return <div className="flex flex-col gap-2">
    {localStatus === "PENDING" ? (
      creator ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[#d9e5df] bg-[#f8faf8] p-2">
          <label className="flex min-w-[150px] flex-col gap-1 text-xs text-[#46615b]">
            Privacidad en TikTok{creator.nickname ? ` · ${creator.nickname}` : ""}
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value)}
              className="rounded-lg border border-[#cbdcd4] bg-white px-2 py-2 text-sm" disabled={busy}>
              <option value="">Selecciona privacidad</option>
              {creator.privacyOptions.map((option) =>
                <option key={option} value={option}>{PRIVACY_LABELS[option] || option}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-3 text-xs text-[#46615b]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!disableComment} disabled={busy || creator.commentsDisabled}
                onChange={(event) => setDisableComment(!event.target.checked)}/>
              Comentarios
            </label>
            {mediaKind === "video" && <>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!disableDuet} disabled={busy || creator.duetDisabled}
                  onChange={(event) => setDisableDuet(!event.target.checked)}/>
                Dúos
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!disableStitch} disabled={busy || creator.stitchDisabled}
                  onChange={(event) => setDisableStitch(!event.target.checked)}/>
                Pegar
              </label>
            </>}
          </div>
          <button type="button" disabled={busy || !privacy} onClick={() => void send()}
            className="rounded-lg bg-[#173b3a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Enviando..." : "Publicar en TikTok"}
          </button>
          <button type="button" onClick={() => setCreator(null)} disabled={busy}
            className="rounded-lg border px-3 py-2 text-xs text-[#607771]">Cancelar</button>
        </div>
      ) : (
        <button type="button" onClick={() => void prepare()} disabled={busy}
          className="rounded-lg border border-[#cbdcd4] bg-white px-3 py-2 text-xs font-semibold text-[#173b3a] disabled:opacity-50">
          {busy ? "Consultando TikTok..." : "Preparar publicación TikTok"}
        </button>
      )
    ) : (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#607771]">TikTok: {localStatus === "SUCCEEDED" ? "Publicado" : localStatus === "PROCESSING" ? "Procesando" : localStatus === "FAILED" ? "Falló" : "Por verificar"}</span>
        {localStatus === "PROCESSING" && <button type="button" onClick={() => void checkStatus()} disabled={busy}
          className="rounded-lg border px-3 py-2 text-xs font-semibold text-[#176c63] disabled:opacity-50">
          {busy ? "Consultando..." : "Comprobar TikTok"}
        </button>}
      </div>
    )}
    {message && <p role="status" className="max-w-md text-xs leading-5 text-[#607771]">{message}</p>}
  </div>;
}
