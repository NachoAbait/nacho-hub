"use client";

import { useEffect, useState } from "react";
import { loadVideoClips, type VideoClip } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

const STATUS_STYLE: Record<VideoClip["status"], { label: string; dot: string; box: string }> = {
  pending: { label: "Pendiente", dot: "bg-white/40", box: "border-white/10 bg-white/5" },
  processing: { label: "Editando", dot: "bg-sky-400", box: "border-sky-400/25 bg-sky-400/5" },
  done: { label: "Listo", dot: "bg-emerald-400", box: "border-emerald-400/20 bg-emerald-400/5" },
  error: { label: "No se pudo", dot: "bg-rose-400", box: "border-rose-400/25 bg-rose-400/5" },
};

/**
 * Los clips que Franco va encontrando en la carpeta de Drive, una tarjeta por clip con su estado —
 * nunca un informe en markdown (regla del hub: ver price-historian-panel.tsx para el mismo patrón
 * de tarjetas con dot de estado).
 */
export function VideoEditorPanel() {
  const [clips, setClips] = useState<VideoClip[] | undefined>(undefined);
  useEffect(() => {
    loadVideoClips().then(setClips);
  }, []);

  if (clips === undefined) return <PanelSkeleton />;
  if (clips.length === 0) {
    return (
      <p className="text-xs text-white/50">
        Todavía no encontró clips nuevos en la carpeta de Drive (&quot;VIDEOS BNB STORE&quot;).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        Clips de la carpeta de Drive
      </h3>
      <div className="flex flex-col gap-2 text-[11px]">
        {clips.map((clip) => {
          const style = STATUS_STYLE[clip.status];
          return (
            <div key={clip.id} className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${style.box}`}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 flex-none rounded-full ${style.dot}`} />
                <span className="min-w-0 flex-1 truncate font-semibold text-white/90">{clip.driveFileName}</span>
                <span className="flex-none text-[10px] uppercase tracking-wider text-white/40">{style.label}</span>
              </div>

              {clip.productHint && (
                <p className="text-white/60">
                  Producto detectado: <span className="text-amber-300">{clip.productHint}</span>
                </p>
              )}

              {clip.status === "done" && clip.outputUrl && (
                <a
                  href={clip.outputUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-lg border border-white/10"
                >
                  <video src={clip.outputUrl} className="aspect-[9/16] w-full max-w-[160px] bg-black object-cover" muted preload="metadata" />
                  <span className="block px-2 py-1 text-center text-[10px] text-amber-300">Ver reel editado →</span>
                </a>
              )}

              {clip.status === "error" && clip.errorMessage && (
                <p className="text-white/70">{clip.errorMessage}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
