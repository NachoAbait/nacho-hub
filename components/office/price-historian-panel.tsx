"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPriceHistory, type PriceHistoryResult } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/types";
import type { ModelLine, ProductHistory } from "@/lib/price-history";

const STATUS_GOOD = "#0ca30c";
const STATUS_CRITICAL = "#d03b3b";

function money(n: number): string {
  return `US$ ${Math.round(n).toLocaleString("es-AR")}`;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

function lineLabel(l: ModelLine): string {
  return `${l.model}${l.capacity ? ` ${l.capacity}` : ""}`;
}

function productLabel(p: ProductHistory): string {
  return `${p.model}${p.capacity ? ` ${p.capacity}` : ""}`;
}

/** Posición 0-100 de `cost` entre el mín y el máx de la fila (50 = punto medio). */
function rowPosition(cost: number, min: number, max: number): number {
  const range = max - min;
  return range > 0 ? ((cost - min) / range) * 100 : 50;
}

/** Color divergente verde(barato)->neutro->rojo(caro), mismos polos que la barra de IndexCard. */
function heatColor(pos: number): string {
  if (pos <= 50) {
    const t = (50 - pos) / 50;
    return `rgba(12,163,12,${(t * 0.75).toFixed(2)})`;
  }
  const t = (pos - 50) / 50;
  return `rgba(208,59,59,${(t * 0.75).toFixed(2)})`;
}

/** Grilla: eje Y = cada modelo (con su precio actual), eje X = cada día. El color de cada celda
 * es la posición del precio de ese día dentro del mín→máx histórico de esa fila (verde = barato,
 * rojo = caro). Hover muestra el valor exacto. */
function PriceHeatmap({ lines }: { lines: ModelLine[] }) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) for (const p of l.series) set.add(p.date);
    return [...set].sort();
  }, [lines]);

  const rows = useMemo(
    () =>
      lines.map((l) => {
        const byDate = new Map(l.series.map((p) => [p.date, p.cost]));
        const costs = l.series.map((p) => p.cost);
        return { l, byDate, min: Math.min(...costs), max: Math.max(...costs), current: l.series[l.series.length - 1].cost };
      }),
    [lines],
  );

  const xLabelEvery = Math.max(1, Math.ceil(dates.length / 10));
  const hoverCost = hover ? rows[hover.row]?.byDate.get(dates[hover.col]) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[120px] bg-[#1a1a19] px-2 py-1 text-left font-semibold text-white/50">Modelo</th>
              {dates.map((d, i) => (
                <th key={d} className="min-w-[30px] px-0.5 py-1 text-center font-normal whitespace-nowrap text-white/35">
                  {i % xLabelEvery === 0 ? fmtDate(d) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={`${row.l.model}|${row.l.capacity ?? ""}`}>
                <td className="sticky left-0 z-10 min-w-[120px] bg-[#1a1a19] px-2 py-1">
                  <div className="truncate font-semibold text-white/85">{lineLabel(row.l)}</div>
                  <div className="text-white/45">{money(row.current)}</div>
                </td>
                {dates.map((d, ci) => {
                  const cost = row.byDate.get(d);
                  const isHover = hover?.row === ri && hover?.col === ci;
                  return (
                    <td key={d} className="min-w-[30px] px-0.5 py-1" onPointerEnter={() => cost != null && setHover({ row: ri, col: ci })} onPointerLeave={() => setHover(null)}>
                      {cost != null && (
                        <div
                          className={`mx-auto h-5 w-full rounded ${isHover ? "ring-1 ring-white/70" : ""}`}
                          style={{ background: heatColor(rowPosition(cost, row.min, row.max)) }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[9px] text-white/35">
        <span>
          {hover && hoverCost != null
            ? <>{lineLabel(rows[hover.row].l)} · {fmtDate(dates[hover.col])}: <span className="font-semibold text-white/85">{money(hoverCost)}</span></>
            : "Pasá el mouse por una celda para ver el precio exacto."}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded" style={{ background: "rgba(12,163,12,0.75)" }} /> barato</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-white/10" /> neutro</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded" style={{ background: "rgba(208,59,59,0.75)" }} /> caro</span>
        </span>
      </div>
    </div>
  );
}

function IndexCard({ p, bucket }: { p: ProductHistory; bucket: "cheap" | "expensive" }) {
  const range = p.max - p.min;
  const position = range > 0 ? Math.round(((p.current - p.min) / range) * 100) : 50;
  const color = bucket === "cheap" ? STATUS_GOOD : STATUS_CRITICAL;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="truncate text-[11px] font-semibold text-white/90">{productLabel(p)}</div>
      <div className="mt-0.5 text-sm font-bold text-white">{money(p.current)}</div>
      <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(position, 4)}%`, background: color }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-white/40">
        <span>mín {money(p.min)}</span>
        <span>máx {money(p.max)}</span>
      </div>
      {p.pctVsWeek != null && Math.abs(p.pctVsWeek) >= 1 && (
        <div className="mt-1 text-[10px] font-semibold" style={{ color: p.pctVsWeek < 0 ? STATUS_GOOD : STATUS_CRITICAL }}>
          {p.pctVsWeek < 0 ? "▼" : "▲"} {Math.abs(p.pctVsWeek)}% vs. hace 7 días
        </div>
      )}
    </div>
  );
}

const MIN_DAYS_FOR_INDEX = 3;
const CHEAP_MAX_POS = 35;
const EXPENSIVE_MIN_POS = 65;

/**
 * Panel de Delfina: sin texto para leer — tabs por categoría, una grilla con un modelo por fila
 * (la capacidad más chica cuando hay varias) y un día por columna, coloreada barato→caro, y abajo
 * tarjetas con un índice visual (barra min→máx) de qué conviene stockear y qué está caro ahora.
 * Siempre en vivo.
 */
export function PriceHistorianPanel() {
  const [data, setData] = useState<PriceHistoryResult | null>(null);
  const [category, setCategory] = useState<Category>("iphone");

  useEffect(() => { loadPriceHistory().then(setData); }, []);

  if (data === null) return <PanelSkeleton />;
  if (!data.totalDays) return <p className="text-xs text-white/50">Todavía no hay cotizaciones guardadas.</p>;

  // Menos de 2 días no dibuja una línea (un punto solo no muestra "comportamiento a lo largo del
  // tiempo") y de paso saca del gráfico los casos sueltos que inflarían la escala para todo el resto.
  const lines = data.lines.filter((l) => l.category === category && l.series.length >= 2);
  const products = data.products.filter((p) => p.category === category && p.days >= MIN_DAYS_FOR_INDEX && p.max > p.min);
  const cheap = products
    .map((p) => ({ p, pos: ((p.current - p.min) / (p.max - p.min)) * 100 }))
    .filter((r) => r.pos <= CHEAP_MAX_POS)
    .sort((a, b) => a.pos - b.pos)
    .map((r) => r.p);
  const expensive = products
    .map((p) => ({ p, pos: ((p.current - p.min) / (p.max - p.min)) * 100 }))
    .filter((r) => r.pos >= EXPENSIVE_MIN_POS)
    .sort((a, b) => b.pos - a.pos)
    .map((r) => r.p);

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-white/45">
        <span>{data.totalDays} día{data.totalDays === 1 ? "" : "s"} de historial, desde el {data.firstDate ? fmtDate(data.firstDate) : "-"}.</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${c === category ? "border-amber-400/50 bg-amber-400/15 text-amber-200" : "border-white/15 text-white/60 hover:bg-white/5"}`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div>
        {lines.length ? <PriceHeatmap lines={lines} /> : <p className="text-white/50">Sin historial en esta categoría.</p>}
      </div>

      {(cheap.length > 0 || expensive.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/45">Para stockear</h3>
            {cheap.length ? cheap.map((p) => <IndexCard key={p.key} p={p} bucket="cheap" />) : <p className="text-white/30">Nada en mínimo ahora.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/45">Caros ahora</h3>
            {expensive.length ? expensive.map((p) => <IndexCard key={p.key} p={p} bucket="expensive" />) : <p className="text-white/30">Nada en máximo ahora.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
