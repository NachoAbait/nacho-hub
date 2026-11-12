"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPriceHistory, type PriceHistoryResult } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/types";
import type { ModelLine, ProductHistory } from "@/lib/price-history";

// Paleta categórica (dark) del sistema de dataviz: orden fijo, nunca ciclada dentro de las 8.
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const STATUS_GOOD = "#0ca30c";
const STATUS_CRITICAL = "#d03b3b";
const GRID = "#2c2c2a";
const AXIS = "#52514e";

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

/** Ticks "lindos" (0, 50, 100, 150...) para el eje Y, sin decimales feos. */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

const W = 620, H = 220, PAD_L = 46, PAD_R = 10, PAD_T = 10, PAD_B = 22;

/** Gráfico de líneas: una por modelo, eje Y precio en USD, eje X fecha. Crosshair + tooltip con
 * todas las series visibles en esa fecha; leyenda clickeable para ocultar/mostrar líneas. */
function PriceChart({ lines }: { lines: ModelLine[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const colored = useMemo(
    () => lines.map((l, i) => ({ ...l, color: PALETTE[i % PALETTE.length], id: `${l.model}|${l.capacity ?? ""}` })),
    [lines],
  );
  const visible = colored.filter((l) => !hidden.has(l.id));

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) for (const p of l.series) set.add(p.date);
    return [...set].sort();
  }, [lines]);
  const dateIndex = useMemo(() => new Map(dates.map((d, i) => [d, i])), [dates]);

  const values = visible.flatMap((l) => l.series.map((p) => p.cost));
  const yMin = values.length ? Math.min(...values) : 0;
  const yMax = values.length ? Math.max(...values) : 1;
  const pad = Math.max((yMax - yMin) * 0.12, 1);
  const domainMin = Math.max(0, yMin - pad);
  const domainMax = yMax + pad;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xAt = (i: number) => PAD_L + (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
  const yAt = (v: number) => PAD_T + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;

  const step = niceStep(domainMax - domainMin, 4);
  const yTicks: number[] = [];
  for (let v = Math.ceil(domainMin / step) * step; v <= domainMax; v += step) yTicks.push(Math.round(v));

  const xLabelEvery = Math.max(1, Math.ceil(dates.length / 6));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = dates.length <= 1 ? 0 : (px / rect.width) * (dates.length - 1);
    setHoverIdx(Math.max(0, Math.min(dates.length - 1, Math.round(frac))));
  }

  const hoverDate = hoverIdx != null ? dates[hoverIdx] : null;
  const hoverRows = hoverDate
    ? visible
        .map((l) => ({ l, cost: l.series.find((p) => p.date === hoverDate)?.cost }))
        .filter((r): r is { l: typeof visible[number]; cost: number } => r.cost != null)
        .sort((a, b) => b.cost - a.cost)
    : [];
  const tooltipX = hoverIdx != null ? xAt(hoverIdx) : 0;
  const tooltipLeft = tooltipX > W * 0.6;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ touchAction: "none" }}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={yAt(t)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="rgba(255,255,255,0.4)">
              {t >= 1000 ? `${Math.round(t / 100) / 10}K` : t}
            </text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke={AXIS} strokeWidth={1} />
        {dates.map((d, i) =>
          i % xLabelEvery === 0 ? (
            <text key={d} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)">
              {fmtDate(d)}
            </text>
          ) : null,
        )}

        {visible.map((l) => {
          const pts = l.series
            .filter((p) => dateIndex.has(p.date))
            .map((p) => [xAt(dateIndex.get(p.date)!), yAt(p.cost)] as const);
          if (pts.length === 0) return null;
          if (pts.length === 1) {
            return <circle key={l.id} cx={pts[0][0]} cy={pts[0][1]} r={3} fill={l.color} />;
          }
          const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
          const last = pts[pts.length - 1];
          return (
            <g key={l.id}>
              <path d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={last[0]} cy={last[1]} r={3.5} fill={l.color} stroke="#1a1a19" strokeWidth={1.5} />
            </g>
          );
        })}

        {hoverIdx != null && (
          <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={PAD_T} y2={PAD_T + innerH} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        )}
        <rect
          x={PAD_L} y={PAD_T} width={innerW} height={innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>

      {hoverDate && hoverRows.length > 0 && (
        <div className={`pointer-events-none absolute z-10 w-44 rounded-lg border border-white/15 bg-black/90 p-2 text-[10px] shadow-xl ${tooltipLeft ? "right-4" : "left-4"}`} style={{ top: 8 }}>
          <div className="mb-1 font-semibold text-white/70">{fmtDate(hoverDate)}</div>
          {hoverRows.map(({ l, cost }) => (
            <div key={l.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="flex items-center gap-1.5 truncate text-white/60">
                <span className="inline-block h-[2px] w-3 shrink-0 rounded" style={{ background: l.color }} />
                <span className="truncate">{lineLabel(l)}</span>
              </span>
              <span className="font-semibold text-white/90">{money(cost)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {colored.map((l) => {
          const isHidden = hidden.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setHidden((prev) => { const next = new Set(prev); if (next.has(l.id)) next.delete(l.id); else next.add(l.id); return next; })}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] transition ${isHidden ? "border-white/5 text-white/30" : "border-white/15 text-white/75"}`}
            >
              <span className="inline-block h-[2px] w-3 rounded" style={{ background: isHidden ? "rgba(255,255,255,0.25)" : l.color }} />
              {lineLabel(l)}
            </button>
          );
        })}
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
 * Panel de Delfina: sin texto para leer — tabs por categoría, un gráfico con una línea por modelo
 * (la capacidad más chica cuando hay varias), y abajo tarjetas con un índice visual (barra min→máx)
 * de qué conviene stockear por barato histórico y qué está caro ahora. Siempre en vivo.
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

      <div className="relative">
        {lines.length ? <PriceChart lines={lines} /> : <p className="text-white/50">Sin historial en esta categoría.</p>}
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
