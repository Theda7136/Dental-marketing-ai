"use client";

import { useMemo, useState } from "react";
import type { ApprovalQueuePost } from "./ApprovalQueue";

type Network = "Facebook" | "Instagram" | "TikTok";
type Delivery = { name: Network; status: string };

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

      {summary.uncertain.length > 0 && (
        <p className="text-sm text-[#786344]">
          Hay {summary.uncertain.length} envíos que requieren seguimiento.
          {" "}<a href="/dashboard/pendientes" className="font-semibold text-[#176c63] hover:underline">Revisar pendientes</a>
        </p>
      )}
      <p className="text-xs leading-5 text-[#71847a]">
        El período se calcula según la fecha de creación de cada propuesta, no la fecha exacta de publicación.
        Solo se incluyen registros actualmente visibles en el panel. El alcance y las interacciones se incorporarán
        cuando sus APIs y permisos estén verificados.
      </p>
    </section>
  );
}
