"use client";

import { useEffect, useState, type FormEvent } from "react";

type InviteInfo = { email: string; role: string };

export default function AcceptInvitation() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InviteInfo | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const invitationToken = new URLSearchParams(window.location.search).get("token") || "";
    window.history.replaceState(null, "", "/invitacion");
    if (!invitationToken) {
      setNotice("Este enlace de invitación es inválido.");
      return;
    }
    setToken(invitationToken);
    fetch(`/api/studio/invitations/accept?token=${encodeURIComponent(invitationToken)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo consultar la invitación.");
        setInvitation(payload);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Invitación inválida."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation || working) return;
    setWorking(true);
    setNotice("");
    try {
      const response = await fetch("/api/studio/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, displayName: name, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo aceptar.");
      setAccepted(true);
      setPassword("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo activar la cuenta.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-5">
      <section className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-800">Dental Studio</p>
        <h1 className="mt-3 text-2xl font-semibold">Únete al equipo</h1>
        {accepted ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-stone-700">Tu cuenta está activa. Ya puedes iniciar sesión.</p>
            <a href="/login" className="inline-block rounded-lg bg-teal-800 px-5 py-3 text-sm font-medium text-white">Ir a iniciar sesión</a>
          </div>
        ) : invitation ? (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-stone-600">Invitación para <strong>{invitation.email}</strong> · Rol: {invitation.role}</p>
            <label className="block text-sm font-medium">Nombre completo
              <input required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)}
                className="mt-2 block w-full rounded-lg border border-stone-300 p-3" />
            </label>
            <label className="block text-sm font-medium">Contraseña nueva (mínimo 16 caracteres)
              <input type="password" required minLength={16} maxLength={256} autoComplete="new-password"
                value={password} onChange={event => setPassword(event.target.value)}
                className="mt-2 block w-full rounded-lg border border-stone-300 p-3" />
            </label>
            <button disabled={working} className="w-full rounded-lg bg-teal-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">
              {working ? "Creando cuenta…" : "Activar mi cuenta"}
            </button>
          </form>
        ) : (
          <p className="mt-5 text-sm text-stone-600">Verificando invitación…</p>
        )}
        {notice && <p role="alert" className="mt-4 text-sm text-red-700">{notice}</p>}
      </section>
    </main>
  );
}
