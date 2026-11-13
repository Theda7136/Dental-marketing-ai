"use client";

import { useMemo, useState } from "react";
import type { ApprovalQueuePost } from "./ApprovalQueue";

type Network = "Facebook" | "Instagram" | "TikTok";
type Delivery = { name: Network; status: string };
type FacebookSnapshot = {
  metrics: { id: string; reactions: number; comments: number; source: "reactions" | "likes" }[];
  checked: number;
  unavailable: number;
  failures?: Record<string, number>;
  scope: string;
};

type InstagramSnapshot = {
  metrics: { id: string; likes: number; comments: number }[];
  checked: number;
  unavailable: number;
  failures?: Record<string, number>;
  scope: string;
};

function insightsMessage(checked: number, unavailable: number, failures?: Record<string, number>) {
  if (checked === 0) return "No hay publicaciones confirmadas de este formato para consultar.";
  if (unavailable === 0) return null;
  if (failures?.token) return "La sesión de Meta podría haber expirado. Revisa la conexión de la cuenta.";
  if (failures?.permissions) return "Meta no autorizó la consulta de interacciones. Revisa los permisos de la conexión.";
  if (failures?.identifier) return "Meta no reconoció algunos identificadores de publicación para esta consulta.";
  if (failures?.incomplete) return "Meta no entregó todas las métricas solicitadas.";
  return "Meta no devolvió los datos de algunas publicaciones. Puedes volver a consultar más tarde.";
}

function deliveryStates(post: ApprovalQueuePost): Delivery[] {
  if (!post.mediaUrl || post.status === "REJECTED") return [];
  return [
    { name: "Facebook", status: post.facebookStatus ?? "PENDING" },
    { name: "Instagram", status: post.instagramStatus ?? "PENDING" },
    ...(post.deliveryFormat === "STORY" ? [] : [{ name: "TikTok" as const, status: post.tiktokStatus ?? "PENDING" }]),
  ];
}

export function PublicationPerformance({ posts }: { posts: readonly ApprovalQueuePost[] }) {
  const [period, setPeriod] = useState("30");
  const [network, setNetwork] = useState<"all" | Network>("all");
  const [instagram, setInstagram] = useState<InstagramSnapshot | null>(null);
  const [instagramLoading, setInstagramLoading] = useState(false);
  const [instagramError, setInstagramError] = useState<string | null>(null);
  const [facebook, setFacebook] = useState<FacebookSnapshot | null>(null);
  const [facebookLoading, setFacebookLoading] = useState(false);
  const [facebookError, setFacebookError] = useState<string | null>(null);

  async function refreshFacebook() {
    setFacebookLoading(true);
    setFacebookError(null);
    try {
      const response = await fetch("/api/performance/facebook", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible consultar Facebook.");
      setFacebook(payload as FacebookSnapshot);
    } catch (error) {
      setFacebook(null);
      setFacebookError(error instanceof Error ? error.message : "No fue posible consultar Facebook.");
    } finally {
      setFacebookLoading(false);
    }
  }

  async function refreshInstagram() {
    setInstagramLoading(true);
    setInstagramError(null);
    try {
      const response = await fetch("/api/performance/instagram", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible consultar Instagram.");
      setInstagram(payload as InstagramSnapshot);
    } catch (error) {
      setInstagram(null);
      setInstagramError(error instanceof Error ? error.message : "No fue posible consultar Instagram.");
    } finally {
      setInstagramLoading(false);
    }
  }

  const summary = useMemo(() => {
    const cutoff = period === "all" ? null : Date.now() - Number(period) * 24 * 60 * 60 * 1000;
    const activePosts = posts.filter((post) =>
      !cutoff || new Date(post.createdAt).getTime() >= cutoff,
    );
    const deliveries = activePosts.flatMap((post) =>
      deliveryStates(post)
        .filter((delivery) => network === "all" || delivery.name === network)
        .map((delivery) => ({ ...delivery, post })),
    );
    const confirmed = deliveries.filter(({ status }) => status === "SUCCEEDED");
    const pending = deliveries.filter(({ status }) => status === "PENDING");
    const uncertain = deliveries.filter(({ status }) => ["UNKNOWN", "IN_PROGRESS", "PROCESSING"].includes(status));
    const other = deliveries.filter(({ status }) => !["SUCCEEDED", "PENDING", "UNKNOWN", "IN_PROGRESS", "PROCESSING"].includes(status));
    const perNetwork = (["Facebook", "Instagram", "TikTok"] as const)
      .filter((name) => network === "all" || network === name)
      .map((name) => {
        const entries = deliveries.filter((delivery) => delivery.name === name);
        return {
          name, total: entries.length,
          confirmed: entries.filter(({ status }) => status === "SUCCEEDED").length,
          pending: entries.filter(({ status }) => status === "PENDING").length,
          uncertain: entries.filter(({ status }) => ["UNKNOWN", "IN_PROGRESS", "PROCESSING"].includes(status)).length,
        };
      });
    return { activePosts, deliveries, confirmed, pending, uncertain, other, perNetwork };
  }, [posts, period, network]);

  const metrics = [
    { label: "Envíos confirmados", value: summary.confirmed.length, hint: "Confirmados por la plataforma" },
    { label: "Sin enviar", value: summary.pending.length, hint: "Aún pendientes por red" },
    { label: "Por comprobar", value: summary.uncertain.length, hint: "Inciertos o en proceso" },
    { label: "Otros estados", value: summary.other.length, hint: "Requieren revisión manual" },
  ];

  return (
    <section className="space-y-5" aria-label="Rendimiento de publicaciones">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.13em] text-[#6e9687]">Resultados de publicaciones</p>
          <h2 className="mt-1 text-xl font-semibold text-[#183d37]">Estado de los envíos</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#667d72]">
            Datos basados en los registros de publicación de la clínica. No representan alcance ni interacción de la audiencia.
          </p>
        </div>
        <a href="/dashboard/historial" className="text-sm font-semibold text-[#176c63] hover:underline">
          Consultar historial
        </a>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs font-semibold text-[#587266]">
          Período de creación
          <select value={period} onChange={(event) => setPeriod(event.target.value)}
            className="min-h-10 rounded-lg border border-[#cbded4] bg-white px-3 text-sm text-[#183d37]">
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="all">Todo el historial</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[#587266]">
          Red social
          <select value={network} onChange={(event) => setNetwork(event.target.value as typeof network)}
            className="min-h-10 rounded-lg border border-[#cbded4] bg-white px-3 text-sm text-[#183d37]">
            <option value="all">Todas las redes</option>
            <option value="Facebook">Facebook</option>
            <option value="Instagram">Instagram</option>
            <option value="TikTok">TikTok</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-[#dce7e0] bg-white p-4">
            <p className="text-xs font-medium text-[#63796e]">{metric.label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-[#18483f]">{metric.value}</p>
            <p className="mt-1 text-xs text-[#819086]">{metric.hint}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-[#dce7e0] bg-white p-4 sm:p-5">
        <h3 className="text-base font-semibold text-[#183d37]">Desglose por plataforma</h3>
        <p className="mt-1 text-xs text-[#6b8177]">
          Un contenido puede contar como un envío en cada red seleccionada. Los estados pendientes no significan fallos.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[430px] text-left text-sm">
            <thead className="border-b border-[#e2ebe5] text-xs text-[#71867b]">
              <tr><th className="pb-3 font-semibold">Red</th><th className="pb-3 text-right font-semibold">Confirmados</th>
                <th className="pb-3 text-right font-semibold">Sin enviar</th><th className="pb-3 text-right font-semibold">Por comprobar</th></tr>
            </thead>
            <tbody>
              {summary.perNetwork.map((entry) => (
                <tr key={entry.name} className="border-b border-[#edf2ee] last:border-0">
                  <td className="py-3 font-medium text-[#23493f]">{entry.name}</td>
                  <td className="py-3 text-right tabular-nums text-[#176c63]">{entry.confirmed}</td>
                  <td className="py-3 text-right tabular-nums text-[#5c7268]">{entry.pending}</td>
                  <td className="py-3 text-right tabular-nums text-[#9a6b36]">{entry.uncertain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#dce7e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#183d37]">Interacciones de Instagram</h3>
            <p className="mt-1 text-xs text-[#6b8177]">
              Me gusta y comentarios consultados directamente en Meta, solo para publicaciones confirmadas.
            </p>
          </div>
          <button type="button" onClick={() => void refreshInstagram()} disabled={instagramLoading}
            className="rounded-lg border border-[#cbded4] bg-white px-4 py-2 text-sm font-semibold text-[#176c63] disabled:opacity-50">
            {instagramLoading ? "Consultando…" : instagram ? "Actualizar datos" : "Consultar Instagram"}
          </button>
        </div>
        {instagramError && <p role="alert" className="mt-3 text-xs text-[#8a5a51]">{instagramError}</p>}
        {instagram && (
          <div className="mt-4">
            {instagram.metrics.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f3f8f5] p-4">
                  <p className="text-xs text-[#63796e]">Me gusta</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-[#18483f]">
                    {instagram.metrics.reduce((total, post) => total + post.likes, 0).toLocaleString("es-CO")}
                  </p>
                </div>
                <div className="rounded-xl bg-[#f3f8f5] p-4">
                  <p className="text-xs text-[#63796e]">Comentarios</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-[#18483f]">
                    {instagram.metrics.reduce((total, post) => total + post.comments, 0).toLocaleString("es-CO")}
                  </p>
                </div>
              </div>
            ) : <p className="text-sm text-[#687e73]">{instagram.checked === 0 ? "Todavía no hay publicaciones elegibles para esta consulta." : "Instagram no devolvió interacciones para las publicaciones consultadas."}</p>}
            {instagram.checked > 0 && insightsMessage(instagram.checked, instagram.unavailable, instagram.failures) && <p className="mt-2 text-xs text-[#8a5a51]">{insightsMessage(instagram.checked, instagram.unavailable, instagram.failures)}</p>}
            <p className="mt-3 text-xs text-[#71847a]">
              {instagram.scope}. Datos disponibles para {instagram.metrics.length} de {instagram.checked} publicaciones.
              {instagram.unavailable > 0 ? " Algunos resultados no estuvieron disponibles en Meta." : ""}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#dce7e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#183d37]">Interacciones de Facebook</h3>
            <p className="mt-1 text-xs text-[#6b8177]">
              Interacciones de fotografías confirmadas del Feed, consultadas directamente en Meta.
            </p>
          </div>
          <button type="button" onClick={() => void refreshFacebook()} disabled={facebookLoading}
            className="rounded-lg border border-[#cbded4] bg-white px-4 py-2 text-sm font-semibold text-[#176c63] disabled:opacity-50">
            {facebookLoading ? "Consultando…" : facebook ? "Actualizar datos" : "Consultar Facebook"}
          </button>
        </div>
        {facebookError && <p role="alert" className="mt-3 text-xs text-[#8a5a51]">{facebookError}</p>}
        {facebook && (
          <div className="mt-4">
            {facebook.metrics.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f3f8f5] p-4">
                  <p className="text-xs text-[#63796e]">{facebook.metrics.every((post) => post.source === "reactions") ? "Reacciones" : facebook.metrics.every((post) => post.source === "likes") ? "Me gusta" : "Reacciones y Me gusta"}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-[#18483f]">
                    {facebook.metrics.reduce((total, post) => total + post.reactions, 0).toLocaleString("es-CO")}
                  </p>
                </div>
                <div className="rounded-xl bg-[#f3f8f5] p-4">
                  <p className="text-xs text-[#63796e]">Comentarios</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-[#18483f]">
                    {facebook.metrics.reduce((total, post) => total + post.comments, 0).toLocaleString("es-CO")}
                  </p>
                </div>
              </div>
            ) : <p className="text-sm text-[#687e73]">{facebook.checked === 0 ? "Todavía no hay publicaciones elegibles para esta consulta." : "Facebook no devolvió interacciones para las publicaciones consultadas."}</p>}
            {insightsMessage(facebook.checked, facebook.unavailable, facebook.failures) && <p className="mt-2 text-xs text-[#8a5a51]">{insightsMessage(facebook.checked, facebook.unavailable, facebook.failures)}</p>}
            <p className="mt-3 text-xs text-[#71847a]">
              {facebook.scope}. Datos disponibles para {facebook.metrics.length} de {facebook.checked} publicaciones.
              {facebook.unavailable > 0 ? " Algunos resultados no estuvieron disponibles en Meta." : ""}
            </p>
          </div>
        )}
      </section>

      <p className="text-xs leading-5 text-[#71847a]">
        El período se calcula según la fecha de creación de cada propuesta, no la fecha exacta de publicación.
        Solo se incluyen registros actualmente visibles en el panel. Los datos de Instagram se consultan
        por separado y pueden requerir permisos adicionales de Meta.
      </p>
    </section>
  );
}
