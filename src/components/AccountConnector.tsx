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
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Cuentas de Redes Sociales</h2>
        {connectionMessage ? (
          <p role="alert" className="mt-2 max-w-xl text-sm text-red-700">{connectionMessage}</p>
        ) : null}
        <p className="text-sm text-gray-500">
          {account?.connected
            ? `Página vinculada: ${account.pageName || "Página Principal"}`
            : "Vincula la cuenta de Instagram Business para habilitar la publicación y programación directa de anuncios."}
        </p>
      </div>

      <div>
        {account?.connected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Conectado ({account.userName || "Meta"})
            </span>
            <a
              href="/api/auth/meta"
              className="text-xs font-medium text-gray-500 hover:text-gray-800 underline ml-2"
            >
              Reconectar
            </a>
          </div>
        ) : (
          <a
            href="/api/auth/meta"
            className="px-5 py-2.5 bg-[#005c53] hover:bg-[#004740] text-white rounded-full text-sm font-medium transition-colors"
          >
            Conectar cuenta
          </a>
        )}
      </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#d9e5df] bg-white p-5">
      <div>
        <p className="font-semibold text-[#173b3a]">TikTok</p>
        <p className="mt-1 text-sm text-[#607771]">
          {tiktokConnected ? `Conectado${tiktokName ? ` · ${tiktokName}` : ""}`
            : "Vincula TikTok para publicar fotos o videos aprobados."}
        </p>
        <p className="mt-1 text-xs text-[#72847d]">Necesita Login Kit, permiso video.publish y un dominio de medios verificado.</p>
      </div>
      <a href="/api/auth/tiktok" className="rounded-lg border border-[#b9d6ca] px-4 py-2.5 text-sm font-semibold text-[#176c63] hover:bg-[#edf5f1]">
        {tiktokConnected ? "Reconectar TikTok" : "Conectar TikTok"}
      </a>
    </div>
    </div>
  );
}