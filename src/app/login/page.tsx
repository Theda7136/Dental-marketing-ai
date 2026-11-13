"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/studio/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
      if (!response.ok) {
        setError("No fue posible ingresar. Revisa tus credenciales.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("No fue posible conectar con Dental Studio.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-12">
      <section className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Dental Studio</span>
          <h1 className="mt-3 text-2xl font-semibold text-stone-900">Iniciar sesión</h1>
          <p className="mt-2 text-sm text-stone-500">Acceso privado de la clínica piloto.</p>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="studio-email" className="mb-2 block text-sm font-medium text-stone-700">Correo electrónico</label>
            <input id="studio-email" type="email" autoComplete="username" required maxLength={254}
              value={email} onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-offset-2" />
          </div>
          <div>
            <label htmlFor="studio-password" className="mb-2 block text-sm font-medium text-stone-700">Contraseña</label>
            <input id="studio-password" type="password" autoComplete="current-password" required
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-offset-2" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={submitting}
            className="w-full rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">
            {submitting ? "Ingresando…" : "Entrar a Dental Studio"}
          </button>
        </form>
      </section>
    </main>
  );
}
