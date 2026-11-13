"use client";

import { useEffect, useState } from "react";
import type { ApprovalQueuePost } from "./ApprovalQueue";
import type { PublishNetwork } from "@/app/dashboard/actions";

type Accounts = { facebook: boolean; instagram: boolean; tiktok: boolean };
type Creator = {
  privacyOptions: string[];
  commentsDisabled?: boolean;
  duetDisabled?: boolean;
  stitchDisabled?: boolean;
};
type PublishOutcome = {
  ok: boolean;
  message: string;
  results: { network: PublishNetwork; outcome: "confirmed" | "processing" | "uncertain" | "not_sent"; message: string }[];
};

const labels: Record<PublishNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};
const privacyLabels: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Público",
  MUTUAL_FOLLOW_FRIENDS: "Amigos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Solo yo",
};
const networks: PublishNetwork[] = ["facebook", "instagram", "tiktok"];

export function MultinetworkPublisher({
  post,
  onPublish,
  onReload,
}: {
  post: ApprovalQueuePost;
  onPublish: (postId: string, networks: PublishNetwork[], tiktok?: {
    privacy: string;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
  }) => Promise<PublishOutcome>;
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [selected, setSelected] = useState<PublishNetwork[]>([]);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [privacy, setPrivacy] = useState("");
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);

  const storyOnly = post.deliveryFormat === "STORY";
  const availableNetworks = storyOnly ? networks.filter((network) => network !== "tiktok") : networks;

  const statuses: Record<PublishNetwork, string> = {
    facebook: post.facebookStatus || "PENDING",
    instagram: post.instagramStatus || "PENDING",
    tiktok: post.tiktokStatus || "PENDING",
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      fetch("/api/social/accounts", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { connected: false })
        .catch(() => ({ connected: false })),
      fetch("/api/social/tiktok", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { connected: false })
        .catch(() => ({ connected: false })),
    ]).then(([meta, tiktok]) => {
      if (!active) return;
      const connected = {
        facebook: Boolean(meta.connected),
        instagram: Boolean(meta.connected && meta.instagramConnected),
        tiktok: Boolean(tiktok.connected),
      };
      setAccounts(connected);
      setSelected(availableNetworks.filter((network) => connected[network] && statuses[network] === "PENDING"));
    });
    return () => { active = false; };
  }, [open, post.id]);

  useEffect(() => {
    if (!open || !selected.includes("tiktok")) {
      setCreator(null);
      setPrivacy("");
      return;
    }
    let active = true;
    setError("");
    void fetch("/api/tiktok/creator", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo consultar TikTok.");
        return payload as Creator;
      })
      .then((settings) => {
        if (!active) return;
        setCreator(settings);
        setPrivacy("");
        setDisableComment(Boolean(settings.commentsDisabled));
        setDisableDuet(Boolean(settings.duetDisabled));
        setDisableStitch(Boolean(settings.stitchDisabled));
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : "TikTok no está disponible.");
      });
    return () => { active = false; };
  }, [open, selected.includes("tiktok")]);

  function toggle(network: PublishNetwork) {
    if (busy) return;
    setSelected((current) => current.includes(network)
      ? current.filter((candidate) => candidate !== network)
      : [...current, network]);
    setOutcome(null);
  }

  async function publish() {
    if (!selected.length || (selected.includes("tiktok") && !privacy)) return;
    setBusy(true);
    setError("");
    setOutcome(null);
    try {
      const result = await onPublish(post.id, availableNetworks.filter((network) => selected.includes(network)),
        selected.includes("tiktok") ? { privacy, disableComment, disableDuet, disableStitch } : undefined);
      setOutcome(result);
      setSelected((current) => current.filter((network) =>
        result.results.some((entry) => entry.network === network && entry.outcome === "not_sent"),
      ));
      try {
        await onReload();
      } catch {
        setError("El envío terminó, pero no se pudo actualizar el panel. Actualiza la página para ver el resultado.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No fue posible completar el envío. Actualiza la página para consultar el resultado.");
    } finally {
      setBusy(false);
    }
  }

  const hasPending = availableNetworks.some((network) => statuses[network] === "PENDING");
  if (post.mediaKind === "text" || !post.mediaUrl || !hasPending) return null;

  return (
    <div className="order-first w-full basis-full">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="studio-primary-action inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#126f60] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0b584d]">
          <span aria-hidden="true">↗</span> Publicar en redes
        </button>
      ) : (
        <div className="rounded-xl border border-[#d9e5df] bg-[#f8faf8] p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-[#173b3a]">Selecciona las redes</h4>
              <p className="mt-1 text-xs text-[#667d72]">{storyOnly ? "Esta historia se puede enviar a Facebook e Instagram." : "Selecciona las redes en las que quieres publicar."}</p>
            </div>
            {!busy && <button type="button" onClick={() => { setOpen(false); setOutcome(null); }} className="text-sm text-[#667d72]">Cerrar</button>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {availableNetworks.map((network) => {
              const connected = Boolean(accounts?.[network]);
              const pending = statuses[network] === "PENDING";
              return <label key={network} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selected.includes(network)
                ? "border-[#8ac5ae] bg-[#e8f5ed] text-[#165b4c]"
                : "border-[#d9e5df] bg-white text-[#587066]"} ${!connected || !pending ? "opacity-60" : "cursor-pointer"}`}>
                <input type="checkbox" checked={selected.includes(network)}
                  disabled={busy || !connected || !pending || !accounts}
                  onChange={() => toggle(network)} className="accent-[#126f60]"/>
                {labels[network]}
                {!connected ? <span className="text-xs">(sin conectar)</span>
                  : statuses[network] === "SUCCEEDED" ? <span className="text-xs">(confirmado, no se reenviará)</span>
                  : ["UNKNOWN", "IN_PROGRESS"].includes(statuses[network]) ? <span className="text-xs">(envío no disponible)</span>
                  : !pending ? <span className="text-xs">(no disponible)</span> : null}
              </label>;
            })}
          </div>
          {selected.includes("tiktok") && (
            <div className="mt-3 space-y-3 rounded-lg border border-[#d9e5df] bg-white p-3">
              <p className="text-xs font-semibold text-[#40665a]">Preferencias requeridas por TikTok</p>
              {creator ? <>
                <label className="flex flex-col gap-1 text-xs text-[#536d63]">
                  Privacidad de la publicación
                  <select value={privacy} disabled={busy} onChange={(event) => setPrivacy(event.target.value)}
                    className="min-h-10 rounded-lg border border-[#cadbd1] bg-white px-3 text-sm">
                    <option value="">Seleccionar privacidad</option>
                    {creator.privacyOptions.map((option) =>
                      <option key={option} value={option}>{privacyLabels[option] || option}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap gap-4 text-xs text-[#536d63]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!disableComment} disabled={busy || creator.commentsDisabled}
                      onChange={(event) => setDisableComment(!event.target.checked)}/> Comentarios
                  </label>
                  {post.mediaKind === "video" && <>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!disableDuet} disabled={busy || creator.duetDisabled}
                        onChange={(event) => setDisableDuet(!event.target.checked)}/> Dúos
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!disableStitch} disabled={busy || creator.stitchDisabled}
                        onChange={(event) => setDisableStitch(!event.target.checked)}/> Pegar
                    </label>
                  </>}
                </div>
              </> : <p className="text-xs text-[#687e73]">Consultando opciones de privacidad…</p>}
            </div>
          )}
          <button type="button" onClick={() => void publish()}
            disabled={busy || !selected.length || !accounts || (selected.includes("tiktok") && !privacy)}
            className="mt-3 min-h-11 rounded-lg bg-[#126f60] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0b584d] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Publicando en las redes seleccionadas…" : "Publicar en redes seleccionadas"}
          </button>
          <p className="mt-2 text-xs text-[#71837b]">Solo se enviarán las redes pendientes seleccionadas.</p>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
      {outcome && <div role="status" className="mt-2 rounded-lg border border-[#d9e5df] bg-white p-3 text-xs text-[#526762]">
        {outcome.results.map((entry) =>
          <p key={entry.network} className="py-1"><strong>{labels[entry.network]}:</strong> {entry.message}</p>)}
        <p className="mt-1 font-semibold">{outcome.message}</p>
      </div>}
    </div>
  );
}
