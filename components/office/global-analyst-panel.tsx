"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { loadGlobalHighlights, type Highlight } from "@/app/actions";

/** El resumen de Mateo: los datos sueltos (dólar, BTC, Fed...) como tarjetas arriba, el informe completo con fuentes colapsado abajo. */
export function GlobalAnalystPanel() {
  const [data, setData] = useState<{ date: string; highlights: Highlight[]; markdown: string } | null | undefined>(undefined);

  useEffect(() => { loadGlobalHighlights().then(setData); }, []);

  if (data === undefined) return <p className="text-xs text-white/50">Cargando…</p>;
  if (!data) return <p className="text-xs text-white/50">Todavía no hay informe de hoy.</p>;

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      {data.highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {data.highlights.map((h, i) => (
            <div key={i} className="rounded-lg border border-teal-400/25 bg-teal-400/5 px-2 py-1.5">
              <div className="truncate text-[9px] uppercase tracking-wider text-teal-300/70">{h.label}</div>
              <div className="mt-0.5 font-bold text-white/90">{h.value}</div>
            </div>
          ))}
        </div>
      )}
      <details className="rounded-lg border border-white/10 p-2" open={data.highlights.length === 0}>
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">Informe completo, con fuentes</summary>
        <div className="mt-2 text-[13px] leading-relaxed text-white/80 [&_a]:text-amber-300 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
          <Markdown>{data.markdown}</Markdown>
        </div>
      </details>
    </div>
  );
}
