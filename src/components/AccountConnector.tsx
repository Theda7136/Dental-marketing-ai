"use client";

import { useEffect, useState } from "react";

type MetaAccount = {
  connected: boolean;
  userName?: string;
  pageName?: string;
  instagramConnected?: boolean;
  instagramCheck?: "verified" | "unavailable";
};

type TikTokAccount = {
  connected: boolean;
  userName?: string | null;
};

const META_ERRORS: Record<string, string> = {
  no_page: "Meta no encontró una Página administrada por tu cuenta.",
  multiple_pages: "Administra varias Páginas. Configura META_PAGE_ID para seleccionar la de la clínica.",
  page_not_found: "No se encontró la Página indicada en META_PAGE_ID.",
  pages_failed: "No pudimos consultar tus Páginas. Revisa los permisos concedidos.",
  token_failed: "Meta no completó la autorización.",
  token_exchange_failed: "Meta no pudo renovar la autorización.",
  invalid_state: "La autorización de Meta caducó. Intenta conectar de nuevo.",
};

function ConnectionCard({
  name,
  description,
  connected,
  detail,
  href,
  action,
  badge,
}: {
  name: string;
  description: string;
  connected: boolean;
  detail?: string;
  href: string;
  action: string;
  badge?: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-5 rounded-2xl border border-[#dce7e0] bg-white p-5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eaf4ef] text-[#106d60]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="5" width="16" height="14" rx="4" />
            <path d="M8 12h8M12 8v8" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[#183d37]">{name}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${connected
              ? "border-[#c4e2d5] bg-[#ecf8f0] text-[#15715d]"
              : "border-[#e2e9e3] bg-[#f7f9f7] text-[#657b70]"}`}>
              {connected ? "Conectada" : "Sin conectar"}
            </span>
            {badge && <span className="text-xs text-[#71867b]">{badge}</span>}
          </div>
          <p className="mt-1 text-sm leading-5 text-[#5e756e]">{description}</p>
          {detail && <p className="mt-1 text-xs leading-5 text-[#788b83]">{detail}</p>}
        </div>
      </div>
      <a
        href={href}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#bbd7c9] bg-white px-4 py-2.5 text-sm font-semibold text-[#106a5b] transition hover:bg-[#edf6f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#106a5b]"
      >
        {action}
      </a>
    </div>
  );
}

export function AccountConnector() {
  const [meta, setMeta] = useState<MetaAccount | null>(null);
  const [tiktok, setTikTok] = useState<TikTokAccount | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const metaError = search.get("error");
    const tiktokResult = search.get("tiktok");

    if (metaError && META_ERRORS[metaError]) setMessage(META_ERRORS[metaError]);
    if (tiktokResult === "connected") setMessage("TikTok se conectó correctamente.");
    else if (tiktokResult === "scope_missing") {
      setMessage("TikTok no concedió el permiso video.publish. Vuelve a conectar la cuenta.");
    } else if (tiktokResult) setMessage("No se pudo conectar TikTok. Comprueba los permisos y la configuración OAuth.");

    let active = true;
    void Promise.all([
      fetch("/api/social/accounts", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { connected: false })
        .catch(() => ({ connected: false })),
      fetch("/api/social/tiktok", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { connected: false })
        .catch(() => ({ connected: false })),
    ]).then(([metaAccount, tiktokAccount]) => {
      if (!active) return;
      setMeta(metaAccount);
      setTikTok(tiktokAccount);
    });
    return () => { active = false; };
  }, []);

  return (
    <section className="space-y-4" aria-label="Conexiones con redes sociales">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.13em] text-[#6e9687]">Canales de publicación</p>
          <h2 className="mt-1 text-lg font-semibold text-[#183d37]">Tus redes sociales</h2>
          <p className="mt-1 text-sm text-[#667d72]">Conecta cada plataforma una sola vez y gestiona las publicaciones desde Pendientes.</p>
        </div>
        <span className="rounded-full border border-[#d6e5dc] bg-white px-3 py-1 text-xs text-[#607970]">
          {[meta?.connected, meta?.instagramConnected, tiktok?.connected].filter(Boolean).length} de 3 canales conectados
        </span>
      </div>
      {message && <p role="status" className="rounded-xl border border-[#cde4d6] bg-[#f0f8f2] px-4 py-3 text-sm text-[#245e4a]">{message}</p>}
      <div className="space-y-3">
        <ConnectionCard
          name="Facebook"
          connected={Boolean(meta?.connected)}
          description={meta?.connected ? `Página: ${meta.pageName || "Página principal"}` : "Publica fotografías y videos en la Página de la clínica."}
          detail="Facebook e Instagram se autorizan mediante Meta."
          href="/api/auth/meta"
          action={meta?.connected ? "Reconectar Meta" : "Conectar Meta"}
        />
        <ConnectionCard
          name="Instagram"
          connected={Boolean(meta?.instagramConnected)}
          description={meta?.instagramConnected
            ? "Cuenta profesional de Instagram detectada mediante Meta Graph API."
            : meta?.instagramCheck === "unavailable"
              ? "No pudimos verificar Instagram en Meta. Revisa los permisos instagram_basic y pages_read_engagement."
              : "La Página no devuelve una cuenta profesional de Instagram a través de Meta Graph API."}
          detail="Debe estar vinculada a esta Página y autorizada con permisos instagram_basic e instagram_content_publish."
          href="/api/auth/meta"
          action={meta?.instagramConnected ? "Reconectar Meta" : "Configurar Meta"}
        />
        <ConnectionCard
          name="TikTok"
          connected={Boolean(tiktok?.connected)}
          description={tiktok?.connected ? `Cuenta vinculada${tiktok.userName ? `: ${tiktok.userName}` : ""}` : "Conecta TikTok para publicar fotografías o videos desde Dental Studio."}
          detail="Requiere Login Kit, video.publish y un dominio HTTPS verificado por TikTok."
          href="/api/auth/tiktok"
          action={tiktok?.connected ? "Reconectar TikTok" : "Conectar TikTok"}
        />
      </div>
      <p className="text-xs leading-5 text-[#74877e]">Cada red mantiene su autorización y estado de envío. La publicación conjunta se incorporará en una actualización posterior.</p>
    </section>
  );
}
