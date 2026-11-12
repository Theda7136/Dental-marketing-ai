"use client";

import { useEffect, useState, type FormEvent } from "react";

type Brand = {
  clinicName: string;
  primaryColor: string;
  fontFamily: string;
  logoDataUrl: string | null;
};

const initialBrand: Brand = {
  clinicName: "Dental Studio",
  primaryColor: "#116D60",
  fontFamily: "SANS",
  logoDataUrl: null,
};

export default function BrandEditor() {
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/brand", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo consultar la identidad de marca.");
        return response.json();
      })
      .then(({ brand: saved }: { brand: Brand }) => {
        if (active) setBrand(saved);
      })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);

  async function saveBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("clinicName", brand.clinicName);
      form.set("primaryColor", brand.primaryColor);
      form.set("fontFamily", brand.fontFamily);
      if (logo) form.set("logo", logo);
      if (removeLogo) form.set("removeLogo", "true");

      const response = await fetch("/api/brand", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar la identidad visual.");
      setBrand(payload.brand as Brand);
      setLogo(null);
      setRemoveLogo(false);
      setFeedback("Identidad de marca guardada. Podrás utilizarla para futuras piezas.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la identidad visual.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="studio-brand-settings" aria-labelledby="brand-heading">
      <div className="studio-brand-heading">
        <h2 id="brand-heading">Identidad de marca</h2>
        <p>Configura los elementos visuales de la clínica para próximas piezas de marketing.</p>
      </div>
      <form onSubmit={saveBrand} className="studio-brand-form">
        <label>Nombre comercial
          <input required maxLength={70} value={brand.clinicName}
            onChange={(event) => setBrand({ ...brand, clinicName: event.target.value })} />
        </label>
        <div className="studio-brand-fields">
          <label>Color principal
            <input type="color" value={brand.primaryColor}
              onChange={(event) => setBrand({ ...brand, primaryColor: event.target.value })} />
          </label>
          <label>Tipografía
            <select value={brand.fontFamily}
              onChange={(event) => setBrand({ ...brand, fontFamily: event.target.value })}>
              <option value="SANS">Clínica · Sans</option>
              <option value="SERIF">Editorial · Serif</option>
              <option value="MODERN">Moderna · Sistema</option>
            </select>
          </label>
        </div>
        <label>Logotipo (PNG, JPG o WebP, máximo 2 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              setLogo(event.currentTarget.files?.[0] ?? null);
              setRemoveLogo(false);
            }} />
        </label>
        {brand.logoDataUrl && !removeLogo && (
          <div className="studio-brand-logo">
            <img src={brand.logoDataUrl} alt="Logotipo actual de la clínica" />
            <button type="button" onClick={() => { setRemoveLogo(true); setLogo(null); }}>
              Quitar logotipo
            </button>
          </div>
        )}
        <div className="studio-brand-example" style={{
          borderLeftColor: brand.primaryColor,
          fontFamily: brand.fontFamily === "SERIF" ? "Georgia, serif" : brand.fontFamily === "MODERN" ? "Arial, sans-serif" : "inherit",
        }}>
          <span>VISTA PREVIA DE MARCA</span>
          <strong>{brand.clinicName || "Nombre de la clínica"}</strong>
          <p>Una identidad consistente para tus próximas campañas.</p>
        </div>
        <p className="studio-brand-note">Estos ajustes no modifican fotografías clínicas ni publicaciones anteriores. Los recursos de marca se conservarán para futuras plantillas.</p>
        {error && <p role="alert" className="studio-feedback-error">{error}</p>}
        {feedback && <p role="status" className="studio-feedback-success">{feedback}</p>}
        <button type="submit" disabled={busy} className="studio-brand-save">
          {busy ? "Guardando…" : "Guardar identidad"}
        </button>
      </form>
    </section>
  );
}
