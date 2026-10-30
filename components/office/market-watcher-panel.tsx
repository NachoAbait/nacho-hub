"use client";

import { useEffect, useState } from "react";
import { loadMarketReport, type MarketReport } from "@/app/actions";
import type { BusinessContext } from "@/lib/types";

const DOLAR_COLOR: Record<string, string> = {
  oficial: "border-white/15 bg-white/5",
  blue: "border-sky-400/30 bg-sky-400/10",
  bolsa: "border-violet-400/30 bg-violet-400/10",
  contadoconliqui: "border-violet-400/30 bg-violet-400/10",
  mayorista: "border-white/15 bg-white/5",
  cripto: "border-amber-400/30 bg-amber-400/10",
  tarjeta: "border-white/15 bg-white/5",
};

function timeAgo(pubDate: string): string {
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return "";
  const hours = Math.round((Date.now() - t) / 3_600_000);
  if (hours < 1) return "hace minutos";
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.round(hours / 24)}d`;
}

/** El cuadro de Tomás, visual: el dólar como ticker de tarjetas, las noticias como lista clickeable. Siempre en vivo. */
export function MarketWatcherPanel({ context }: { context: BusinessContext }) {
  const [loaded, setLoaded] = useState<{ context: BusinessContext; report: MarketReport } | null>(null);
  useEffect(() => { loadMarketReport(context).then((report) => setLoaded({ context, report })); }, [context]);
  const report = loaded?.context === context ? loaded.report : null;

  if (report === null) return <p className="text-xs text-white/50">Cargando…</p>;

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      {report.dolares.length === 0 ? (
        <p className="text-white/50">No pude leer la cotización del dólar ahora.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {report.dolares.map((d) => (
            <div key={d.casa} className={`rounded-lg border px-2 py-1.5 ${DOLAR_COLOR[d.casa] ?? "border-white/15 bg-white/5"}`}>
              <div className="truncate text-[9px] uppercase tracking-wider text-white/50">{d.nombre}</div>
              <div className="mt-0.5 font-bold text-white/90">${d.venta.toLocaleString("es-AR")}</div>
              <div className="text-white/40">compra ${d.compra.toLocaleString("es-AR")}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Noticias</h3>
        {report.news.length === 0 ? (
          <p className="text-white/50">No encontré titulares relevantes ahora.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {report.news.map((n) => (
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
    </div>
  );
}
