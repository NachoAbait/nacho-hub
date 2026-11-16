"use client";

import { useEffect, useState } from "react";
import { loadReelScoutReport, type ReelScoutFindings } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

/** Las referencias de Renata, una tarjeta por reel en vez de un bloque de texto. Reel Scout solo
 * corre en BNB (no tiene selector de contexto, a diferencia de los paneles que sí lo reciben). */
export function ReelScoutPanel() {
  const [data, setData] = useState<{ date: string; findings: ReelScoutFindings } | null | undefined>(undefined);
  useEffect(() => { loadReelScoutReport().then(setData); }, []);

  if (data === undefined) return <PanelSkeleton />;
  if (!data) return <p className="text-xs text-white/50">Todavía no investigó reels.</p>;

  const { findings } = data;

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {!findings.foundReferences && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-white/60">
          Sin referencias verificables hoy (búsqueda agotada o sin resultados dentro de la ventana).
        </p>
      )}

      {findings.references.map((r, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/5 p-2">
          <p className="truncate text-[10px] uppercase tracking-wider text-fuchsia-300/80">{r.source}</p>
          <p className="text-white/85">🪝 {r.hook}</p>
          <p className="text-white/60">{r.whyItWorked}</p>
        </div>
      ))}

      {findings.patterns.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Patrones</h4>
          <ul className="flex flex-col gap-1">
            {findings.patterns.map((p, i) => (
              <li key={i} className="flex gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-white/75">
                <span className="text-white/35">•</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {findings.todayAction && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-2 py-1.5 text-white/80">
          👉 {findings.todayAction}
        </p>
      )}
    </div>
  );
}
