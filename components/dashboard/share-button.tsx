"use client";

import { useState } from "react";

interface Props {
  imageUrl: string;
  fileName: string;
  title: string;
}

/** Descarga el blob de la imagen: hace falta para las dos rutas (share sheet nativo y fallback),
 * ya que un <a href="...supabase..." download> solo abre una pestaña en vez de bajar el archivo
 * cuando el link es de otro origen. */
async function fetchImageFile(imageUrl: string, fileName: string): Promise<File> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`No pude bajar la imagen (HTTP ${res.status})`);
  const blob = await res.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

function downloadBlob(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** En el celular abre el menú nativo (Guardar, WhatsApp, Copiar, etc.) con la imagen ya adjunta.
 * En desktop, o si el navegador no soporta compartir archivos, descarga el PNG directo — nunca
 * abre una pestaña nueva para que lo bajes vos a mano. */
export function ShareButton({ imageUrl, fileName, title }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const file = await fetchImageFile(imageUrl, fileName);
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title });
      } else {
        downloadBlob(file);
      }
    } catch (err) {
      // El usuario cancelando el share sheet también tira AbortError: no es un error real.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "No se pudo compartir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {busy ? "Un momento…" : "Compartir / Descargar"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
