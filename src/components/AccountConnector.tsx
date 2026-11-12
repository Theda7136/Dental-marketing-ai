"use client";

import { useEffect, useState } from "react";

export function AccountConnector() {
  const [account, setAccount] = useState<{
    connected: boolean;
    userName?: string;
    pageName?: string;
  } | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [tiktokConnected, setTikTokConnected] = useState(false);
  const [tiktokName, setTikTokName] = useState<string | null>(null);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    const messages: Record<string, string> = {
      no_page: "Meta no encontró una Página que puedas administrar. Revisa que tu usuario tenga acceso a la Página de la clínica e inténtalo otra vez.",
      pages_failed: "Meta no pudo consultar tus Páginas. Revisa los permisos concedidos e inténtalo otra vez.",
      token_failed: "Meta no pudo completar la autorización. Inténtalo de nuevo.",
      token_exchange_failed: "Meta no pudo completar la autorización de larga duración. Reconecta la Página e inténtalo otra vez.",
      invalid_state: "La autorización de Meta caducó o no coincide. Inténtalo de nuevo.",
    };
    if (error && messages[error]) setConnectionMessage(messages[error]);

    fetch("/api/social/tiktok", { cache: "no-store" })
      .then((res) => res.json())
      .then((account) => {
        setTikTokConnected(Boolean(account.connected));
        setTikTokName(account.userName || null);
      })
      .catch(() => setTikTokConnected(false));
    const tiktokStatus = new URLSearchParams(window.location.search).get("tiktok");
    if (tiktokStatus && tiktokStatus !== "connected") {
      setConnectionMessage(tiktokStatus === "scope_missing"
        ? "TikTok no concedió video.publish. Reautoriza el acceso en TikTok."
        : "No se pudo completar la conexión a TikTok. Comprueba la configuración y los permisos.");
    }
    fetch("/api/social/accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setAccount(data);
      })
      .catch((err) => console.error("Error al obtener la cuenta:", err));
  }, []);

  return (
    <section className="mb-6 space-y-4" aria-label="Redes sociales conectadas">
      {connectionMessage && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {connectionMessage}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#d9e5df] bg-white p-5">
        <div>
          <h2 className="font-semibold text-[#173b3a]">Facebook e Instagram</h2>
          <p className="mt-1 text-sm text-[#607771]">
            {account?.connected ? `Página vinculada: ${account.pageName || "Página principal"}`
              : "Conecta tu Página de Facebook y la cuenta profesional de Instagram."}
          </p>
        </div>
        <a href="/api/auth/meta" className="rounded-lg border border-[#b9d6ca] px-4 py-2.5 text-sm font-semibold text-[#176c63]">
          {account?.connected ? "Reconectar Meta" : "Conectar Meta"}
        </a>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#d9e5df] bg-white p-5">
        <div>
          <h2 className="font-semibold text-[#173b3a]">TikTok</h2>
          <p className="mt-1 text-sm text-[#607771]">
            {tiktokConnected ? `Cuenta conectada${tiktokName ? ` · ${tiktokName}` : ""}`
              : "Conecta TikTok para publicar fotografías o videos."}
          </p>
          <p className="mt-1 text-xs text-[#72847d]">
            Requiere permiso video.publish y un dominio HTTPS verificado en TikTok.
          </p>
        </div>
        <a href="/api/auth/tiktok" className="rounded-lg border border-[#b9d6ca] px-4 py-2.5 text-sm font-semibold text-[#176c63]">
          {tiktokConnected ? "Reconectar TikTok" : "Conectar TikTok"}
        </a>
      </div>
    </section>
  );
}
