"use client";

import { useState } from "react";
import { generateClinicalPost } from "@/app/actions/generatePost"; // Ajusta la ruta según donde hayas guardado la Server Action

export function NuevoCasoForm() {
  const [procedure, setProcedure] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [caption, setCaption] = useState("");

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!procedure) return;

    setLoading(true);
    try {
      const res = await generateClinicalPost({ procedure, notes });
      if (res.success && res.caption) {
        setCaption(res.caption);
      } else {
        alert(res.error || "No se pudo generar el contenido.");
      }
    } catch (err) {
      console.error("Error al invocar a Grok:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleGenerate} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Nuevo caso</h2>
        <p className="text-sm text-gray-500">El material se prepara en la clínica y el texto queda en revisión.</p>
      </div>

      {/* Selector de Procedimiento */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Procedimiento</label>
        <select
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          className="w-full rounded-xl border-gray-200 border p-2.5 text-sm focus:ring-2 focus:ring-teal-700 focus:outline-none"
          required
        >
          <option value="">Elige un procedimiento</option>
          <option value="Ortodoncia estética">Ortodoncia estética</option>
          <option value="Implantes dentales">Implantes dentales</option>
          <option value="Diseño de sonrisa y carillas">Diseño de sonrisa y carillas</option>
          <option value="Blanqueamiento dental">Blanqueamiento dental</option>
          <option value="Rehabilitación oral">Rehabilitación oral</option>
        </select>
      </div>

      {/* Notas clínicas opcionales */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notas clínicas / Detalles</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej. Caso de apiñamiento severo resuelto en 12 meses..."
          className="w-full rounded-xl border-gray-200 border p-2.5 text-sm focus:ring-2 focus:ring-teal-700 focus:outline-none"
          rows={3}
        />
      </div>

      {/* Botón de Generación con Grok */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-[#005c53] hover:bg-[#004740] text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Grok-3 está redactando el post...
          </>
        ) : (
          "Generar Texto con Grok-3"
        )}
      </button>

      {/* Caja donde aparece el resultado listo para revisión */}
      {caption && (
        <div className="mt-6 p-4 bg-teal-50/50 border border-teal-100 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-teal-900 text-sm">Vista previa (Revisión clínica):</h3>
            <span className="text-xs text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full font-medium">Listo para aprobar</span>
          </div>
          
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full h-36 p-3 text-xs border border-teal-200 rounded-lg bg-white focus:ring-2 focus:ring-teal-700 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => {
              alert("¡Post guardado en posts pendientes de aprobación!");
              // Aquí conectaremos la acción para enviarlo a la base de datos de pendientes
            }}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Enviar a Posts Pendientes de Aprobación
          </button>
        </div>
      )}
    </form>
  );
}