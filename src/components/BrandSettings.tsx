"use client";

import { useEffect, useState } from "react";

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

export default function BrandSettings() {
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/brand", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la identidad de marca.");
        return response.json();
      })
      .then(({ brand: savedBrand }) => {
        if (active) setBrand(savedBrand);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar la configuración.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const previewUrl = URL.createObjectURL(logo);
    setLogoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [logo]);

  async function saveBrand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);

    const form = new FormData();
    form.set("clinicName", brand.clinicName);
    form.set("primaryColor", brand.primaryColor);
    form.set("fontFamily", brand.fontFamily);
    if (logo) form.set("logo", logo);
    if (removeLogo) form.set("removeLogo", "true");

    try {
      const response = await fetch("/api/brand", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar la marca.");
      setBrand(payload.brand);
      setLogo(null);
      setRemoveLogo(false);
      setFeedback("Identidad de marca guardada.");
      window.dispatchEvent(new CustomEvent("dental-brand-updated", { detail: payload.brand }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al guardar la marca.");
    } finally {
      setSaving(false);
    }
  }

  const visibleLogo = removeLogo ? null : logoPreview ?? brand.logoDataUrl;
  const font = brand.fontFamily === "SERIF"
    ? "Georgia, serif"
    : brand.fontFamily === "MODERN"
      ? "Arial, Helvetica, sans-serif"
      : "inherit";

  return (
    <section className="studio-brand-settings" aria-labelledby="brand-settings-title">
      <div className="studio-brand-intro">
        <h2 id="brand-settings-title">Identidad de marca</h2>
        <p>Configura el aspecto de la clínica. No modifica publicaciones anteriores ni altera fotografías clínicas.</p>
      </div>
      {error && <p className="studio-brand-error" role="alert">{error}</p>}
      {feedback && <p className="studio-brand-success" role="status">{feedback}</p>}
      <div className="studio-brand-grid">
        <form onSubmit={saveBrand} className="studio-brand-fields">
          <label>Nombre de la clínica
            <input required maxLength={70} disabled={loading || saving} value={brand.clinicName}
              onChange={(event) => setBrand({ ...brand, clinicName: event.target.value })}/>
          </label>
          <label>Color principal
            <span className="studio-brand-color-control">
              <input aria-label="Elegir color de marca" type="color" disabled={loading || saving}
                value={brand.primaryColor} onChange={(event) => setBrand({ ...brand, primaryColor: event.target.value })}/>
              <span>{brand.primaryColor.toUpperCase()}</span>
            </span>
          </label>
          <label>Tipografía de la marca
            <select disabled={loading || saving} value={brand.fontFamily}
              onChange={(event) => setBrand({ ...brand, fontFamily: event.target.value })}>
              <option value="SANS">Clásica y clara</option>
              <option value="MODERN">Moderna</option>
              <option value="SERIF">Editorial</option>
            </select>
          </label>
          <label>Logotipo (PNG, JPG o WebP, máximo 2 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={loading || saving}
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                if (chosen && (chosen.size > 2_000_000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(chosen.type))) {
                  setError("El logotipo debe ser PNG, JPG o WebP de máximo 2 MB.");
                  event.target.value = "";
                  return;
                }
                setError(null);
                setLogo(chosen);
                if (chosen) setRemoveLogo(false);
              }}/>
          </label>
          {(brand.logoDataUrl || logo) && <label className="studio-brand-remove">
            <input type="checkbox" checked={removeLogo} onChange={(event) => setRemoveLogo(event.target.checked)}
              disabled={loading || saving}/>
            Quitar logotipo actual
          </label>}
          <button type="submit" disabled={loading || saving} className="studio-generate">
            {saving ? "Guardando…" : "Guardar identidad"}
          </button>
        </form>
        <div className="studio-brand-example">
          <p>Vista de identidad · {logo || removeLogo ? "Cambios sin guardar" : "Actual"}</p>
          <div className="studio-brand-artwork" style={{ borderTopColor: brand.primaryColor, fontFamily: font }}>
            {visibleLogo
              ? <img src={visibleLogo} alt="Logotipo de la clínica" />
              : <span className="studio-brand-initial" style={{ backgroundColor: brand.primaryColor }}>
                  {brand.clinicName.slice(0, 1).toUpperCase()}
                </span>}
            <h3>{brand.clinicName || "Nombre de la clínica"}</h3>
            <span style={{ color: brand.primaryColor }}>Cuidamos cada sonrisa</span>
            <small>Vista orientativa. Guarda los cambios para aplicarlos a nuevas piezas.</small>
          </div>
        </div>
      </div>
    </section>
  );
}
