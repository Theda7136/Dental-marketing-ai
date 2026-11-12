"use client";

import { useEffect, useRef, useState } from "react";

export interface ImageCrop {
  zoom: number;
  x: number;
  y: number;
}

export async function cropImage(file: File, crop: ImageCrop): Promise<File> {
  const image = await createImageBitmap(file);
  try {
    const width = 1080;
    const height = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no permite editar la imagen.");

    const scale = Math.max(width / image.width, height / image.height) * crop.zoom;
    const displayedWidth = image.width * scale;
    const displayedHeight = image.height * scale;
    const freeX = displayedWidth - width;
    const freeY = displayedHeight - height;
    const left = -freeX * ((crop.x + 100) / 200);
    const top = -freeY * ((crop.y + 100) / 200);

    context.drawImage(image, left, top, displayedWidth, displayedHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo exportar la imagen.")), "image/png");
    });
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-encuadrada.png", { type: "image/png" });
  } finally {
    image.close();
  }
}

interface MediaWorkspaceProps {
  file: File | null;
  kind: "photo" | "video";
  crop: ImageCrop;
  onCropChange: (crop: ImageCrop) => void;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export function MediaWorkspace({ file, kind, crop, onCropChange, onFileChange, disabled }: MediaWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const changeFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0] ?? null;
    onFileChange(selected);
  };

  const fileSize = file ? (file.size / (1024 * 1024)).toLocaleString("es-CO", { maximumFractionDigits: 2 }) + " MB" : "";
  const previewTransform = `translate(${crop.x * 0.4}%, ${crop.y * 0.4}%) scale(${crop.zoom})`;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={kind === "photo" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/quicktime,video/webm"}
        disabled={disabled}
        onChange={changeFile}
        className="sr-only"
        aria-label={kind === "photo" ? "Seleccionar fotografía" : "Seleccionar video"}
      />
      <div className="rounded-2xl border border-[#d9e5de] bg-[#f7faf8] p-3">
        {file && preview ? (
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#dcebe5]">
              {kind === "photo"
                ? <img src={preview} alt="Miniatura del archivo seleccionado" className="h-full w-full object-cover" />
                : <video src={preview} muted preload="metadata" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#173b3a]" title={file.name}>{file.name}</p>
              <p className="mt-1 text-xs text-[#637773]">{fileSize}</p>
              <button type="button" disabled={disabled} onClick={() => { if (inputRef.current) inputRef.current.value = ""; inputRef.current?.click(); }} className="mt-2 text-xs font-semibold text-[#147c72] underline underline-offset-4">Reemplazar archivo</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#aacac0] text-sm font-medium text-[#176c63]">
            <span className="text-xl" aria-hidden="true">＋</span>
            {kind === "photo" ? "Seleccionar fotografía" : "Seleccionar video"}
            <span className="text-xs font-normal text-[#82928e]">Vista previa antes de generar</span>
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#dce5df] bg-[#122b29]">
        <div className="relative mx-auto aspect-[4/5] max-h-[420px] w-full overflow-hidden">
          {preview ? kind === "video" ? (
            <video key={preview} src={preview} controls playsInline preload="metadata" className="h-full w-full object-contain" />
          ) : (
            <img src={preview} alt="Vista previa del encuadre" className="h-full w-full object-cover" style={{ transform: previewTransform, transformOrigin: "center" }} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#a9c6c0]">Selecciona un archivo para visualizarlo aquí.</div>
          )}
        </div>
      </div>
      {kind === "photo" && file && (
        <div className="rounded-xl border border-[#dce5df] p-3">
          <p className="mb-3 text-sm font-semibold text-[#173b3a]">Encuadre de la foto</p>
          {([
            ["zoom", "Zoom", 1, 3, 0.05],
            ["x", "Horizontal", -100, 100, 5],
            ["y", "Vertical", -100, 100, 5],
          ] as const).map(([field, label, min, max, step]) => (
            <label key={field} className="mb-2 flex items-center gap-3 text-xs text-[#526762]">
              <span className="w-20">{label}</span>
              <input type="range" min={min} max={max} step={step} value={crop[field]} disabled={disabled} onChange={(event) => onCropChange({ ...crop, [field]: Number(event.target.value) })} className="min-w-0 flex-1 accent-[#147c72]" />
            </label>
          ))}
          <button type="button" disabled={disabled} onClick={() => onCropChange({ zoom: 1, x: 0, y: 0 })} className="mt-1 text-xs font-semibold text-[#147c72]">Restablecer encuadre</button>
        </div>
      )}
    </div>
  );
}
