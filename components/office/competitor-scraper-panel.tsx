"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { loadCompetitorPrices, type CompetitorPrice } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import type { BusinessContext } from "@/lib/types";

type Data = { date: string; prices: CompetitorPrice[]; markdown: string } | null;

/** Lo que investigó Sofía: los precios comparables como tabla arriba, el informe completo con fuentes colapsado abajo. */
export function CompetitorScraperPanel({ context }: { context: BusinessContext }) {
  const [loaded, setLoaded] = useState<{ context: BusinessContext; value: Data } | null>(null);
  useEffect(() => { loadCompetitorPrices(context).then((value) => setLoaded({ context, value })); }, [context]);
  const data = loaded?.context === context ? loaded.value : undefined;

  if (data === undefined) return <PanelSkeleton />;
  if (!data) return <p className="text-xs text-white/50">Todavía no hay informe de hoy.</p>;

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      {data.prices.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-white/45">
              <th className="px-1 pb-1 text-left font-medium">Competidor</th>
              <th className="px-1 pb-1 text-left font-medium">Producto</th>
              <th className="px-1 pb-1 text-right font-medium">Precio</th>
            </tr>
          </thead>
          <tbody>
            {data.prices.map((p, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="px-1 py-1 text-white/70">{p.competitor}</td>
                <td className="px-1 py-1 text-white/85">{p.item}</td>
                <td className="px-1 py-1 text-right font-semibold text-white/90">{p.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="rounded-lg border border-white/10 p-2" open={data.prices.length === 0}>
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">Informe completo, con fuentes</summary>
        <div className="mt-2 text-[13px] leading-relaxed text-white/80 [&_a]:text-amber-300 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
          <Markdown>{data.markdown}</Markdown>
        </div>
      </details>
    </div>
  );
}
