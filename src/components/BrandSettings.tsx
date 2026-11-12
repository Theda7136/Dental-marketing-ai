"use client";

import { useEffect, useState } from "react";

interface Brand {
  clinicName: string;
  primaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  logoDataUrl: string | null;
}

const initial: Brand = {
  clinicName: "Dental Studio",
  primaryColor: "#147c72",
  backgroundColor: "#0a1817",
  fontFamily: "sans",
  logoDataUrl: null,
};

export function BrandSettings() {
  const [brand, setBrand] = useState<Brand>(initial);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    fetch("/api/brand")
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la identidad de marca.");
        return response.json();
      })
      .then(({ brand: stored }: { brand: Brand }) => setBrand(stored))
      .catch((error) => setFailure(error instanceof Error ? error.message : "Error al cargar la marca."));
  }, []);

  const update = (values: Partial<Brand>) => {
    setBrand((current) => ({ ...current, ...values }));
    setMessage("");
  };

  async function selectLogo(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 250 * 1024) {
      setFailure("El logotipo debe ser PNG, JPG o WebP de máximo 250 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      update({ logoDataUrl: String(reader.result) });
      setFailure("");
    };
    reader.onerror = () => setFailure("No se pudo leer el logotipo.");
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setFailure("");
    setMessage("");
    try {
      const response = await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brand),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar la identidad.");
      setBrand(payload.brand);
      setMessage("Identidad guardada. Se aplicará a las nuevas fotografías generadas.");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "No se pudo guardar la identidad.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="app-card rounded-3xl p-5 sm:p-6" aria-label="Identidad visual de la clínica">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-4 text-left">
        <span>
          <span className="eyebrow">Identidad visual</span>
          <span className="mt-1 block text-base font-semibold text-[#173b3a]">Marca de la clínica</span>
          <span className="mt-1 block text-xs text-[#637773]">Logo, colores y tipografía para las próximas publicaciones.</span>
        </span>
        <span className="shrink-0 rounded-full border border-[#d9e5df] px-4 py-2 text-xs font-semibold text-[#176c63]">{expanded ? "Cerrar" : "Configurar"}</span>
      </button>
      {expanded && (
        <div className="mt-5 grid gap-5 border-t border-[#e3e9e5] pt-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-[#173b3a]">Nombre de la clínica
              <input value={brand.clinicName} maxLength={80} onChange={(event) => update({ clinicName: event.target.value })} className="field-control mt-1 block h-11 w-full rounded-xl px-3" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-[#526762]">Color principal
              <input type="color" value={brand.primaryColor} onChange={(event) => update({ primaryColor: event.target.value })} className="h-10 w-20 cursor-pointer" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-[#526762]">Fondo de plantilla
              <input type="color" value={brand.backgroundColor} onChange={(event) => update({ backgroundColor: event.target.value })} className="h-10 w-20 cursor-pointer" />
            </label>
            <label className="text-sm text-[#526762]">Tipografía
              <select value={brand.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })} className="field-control mt-1 block h-11 w-full rounded-xl px-3">
                <option value="sans">Clásica sin serifas</option>
                <option value="serif">Editorial con serifas</option>
                <option value="modern">Moderna geométrica</option>
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-[#173b3a]">Logotipo
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectLogo(event.target.files?.[0])} className="mt-2 block w-full text-xs" />
            </label>
            <div className="flex min-h-36 items-center justify-center rounded-2xl p-5 text-center" style={{ backgroundColor: brand.backgroundColor }}>
              <div style={{ color: brand.primaryColor, fontFamily: brand.fontFamily === "serif" ? "Georgia, serif" : "Arial, sans-serif" }}>
                {brand.logoDataUrl && <img src={brand.logoDataUrl} alt="Logotipo de la clínica" className="mx-auto mb-3 max-h-16 max-w-32 object-contain" />}
                <p className="text-lg font-semibold">{brand.clinicName || "Clínica"}</p>
                <p className="mt-1 text-xs">Vista previa de identidad</p>
              </div>
            </div>
            {brand.logoDataUrl && <button type="button" onClick={() => update({ logoDataUrl: null })} className="self-start text-xs text-[#637773] underline">Quitar logotipo</button>}
          </div>
          <div className="md:col-span-2">
            {failure && <p role="alert" className="mb-2 text-sm text-red-700">{failure}</p>}
            {message && <p role="status" className="mb-2 text-sm text-[#176c63]">{message}</p>}
            <button type="button" disabled={saving} onClick={save} className="rounded-full bg-[#147c72] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar identidad de marca"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
