"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { loadGlobalHighlights, loadMarketReport, type Highlight, type MarketReport } from "@/app/actions";
import { ListSkeleton, PanelSkeleton } from "@/components/office/skeleton";

function timeAgo(pubDate: string): string {
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return "";
  const hours = Math.round((Date.now() - t) / 3_600_000);
  if (hours < 1) return "hace minutos";
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.round(hours / 24)}d`;
}

/** El resumen de Mateo: los datos sueltos (dólar, BTC, Fed...) como tarjetas, las noticias más importantes del día
 * como lista clickeable (siempre en vivo, de Google News), y el informe completo con fuentes colapsado abajo. */
export function GlobalAnalystPanel() {
  const [data, setData] = useState<{ date: string; highlights: Highlight[]; markdown: string } | null | undefined>(undefined);
  const [news, setNews] = useState<MarketReport["news"] | undefined>(undefined);

  useEffect(() => { loadGlobalHighlights().then(setData); }, []);
  useEffect(() => { loadMarketReport("GLOBAL").then((r) => setNews(r.news)); }, []);

  if (data === undefined) return <PanelSkeleton />;
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

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Noticias</h3>
        {news === undefined ? (
          <ListSkeleton />
        ) : news.length === 0 ? (
          <p className="text-white/50">No encontré titulares relevantes ahora.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {news.map((n) => (
              <li key={n.title} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                {n.link ? (
                  <a href={n.link} target="_blank" rel="noreferrer" className="text-white/85 hover:text-amber-300 hover:underline">
                    {n.title}
                  </a>
                ) : (
                  <span className="text-white/85">{n.title}</span>
                )}
                {n.pubDate && <div className="mt-0.5 text-[10px] text-white/35">{timeAgo(n.pubDate)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-lg border border-white/10 p-2" open={data.highlights.length === 0}>
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">Informe completo, con fuentes</summary>
        <div className="mt-2 text-[13px] leading-relaxed text-white/80 [&_a]:text-amber-300 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
          <Markdown>{data.markdown}</Markdown>
        </div>
      </details>
    </div>
  );
}
