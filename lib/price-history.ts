import type { SupabaseClient } from "@supabase/supabase-js";
import { entryKey } from "@/lib/agents/catalog-match";
import type { Category } from "@/lib/types";

interface QuoteRow {
  category: Category;
  model: string;
  chip: string | null;
  cellular: boolean;
  inches: number | null;
  screen_mm: number | null;
  capacity: string | null;
  cost_usd: number;
  quote_date: string;
}

export interface DailyPoint {
  date: string;
  cost: number;
}

export interface ProductHistory {
  key: string;
  category: Category;
  model: string;
  capacity: string | null;
  series: DailyPoint[];
  days: number;
  current: number;
  min: number;
  minDate: string;
  max: number;
  maxDate: string;
  weekAgo: number | null;
  pctVsWeek: number | null;
}

/** Una línea del gráfico por modelo (no por variante exacta): si un modelo existe en más de una
 * capacidad, usa la más chica como representativa — para no inflar el gráfico con una línea por
 * cada capacidad del mismo producto. */
export interface ModelLine {
  category: Category;
  model: string;
  capacity: string | null;
  series: DailyPoint[];
}

export interface PriceHistoryResult {
  totalDays: number;
  firstDate: string | null;
  allDates: string[];
  products: ProductHistory[];
  lines: ModelLine[];
}

const EMPTY: PriceHistoryResult = { totalDays: 0, firstDate: null, allDates: [], products: [], lines: [] };

/** El día con dato más cercano, hacia atrás, a `target`. */
function closestOnOrBefore(dates: string[], target: string): string | null {
  let best: string | null = null;
  for (const d of dates) if (d <= target) best = d;
  return best;
}

/** GB numéricos de una capacidad tipo "256GB" o "1TB", para elegir la más chica como representativa. */
function capacityGb(capacity: string | null): number {
  if (!capacity) return 0;
  const m = capacity.match(/([\d.]+)\s*(GB|TB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return /tb/i.test(m[2]) ? n * 1024 : n;
}

/**
 * Historial de precios por producto, a partir de todas las cotizaciones guardadas (price_quotes,
 * nunca se borran). Comparte la agrupación con Martín y Delfina (misma entryKey) para que "es el
 * mismo producto" signifique lo mismo en todos lados.
 */
export async function computePriceHistory(db: SupabaseClient): Promise<PriceHistoryResult> {
  const { data: quotes, error } = await db
    .from("price_quotes")
    .select("category, model, chip, cellular, inches, screen_mm, capacity, cost_usd, quote_date")
    .returns<QuoteRow[]>();
  if (error) throw new Error(`price_quotes: ${error.message}`);
  if (!quotes?.length) return EMPTY;

  const allDates = [...new Set(quotes.map((q) => q.quote_date))].sort();
  const totalDays = allDates.length;
  const firstDate = allDates[0];

  interface Raw { category: Category; model: string; capacity: string | null; byDate: Map<string, number> }
  const raw = new Map<string, Raw>();
  for (const q of quotes) {
    const key = entryKey(q.category, q.model, q.capacity, q.chip, q.inches, q.cellular, q.screen_mm);
    let r = raw.get(key);
    if (!r) { r = { category: q.category, model: q.model, capacity: q.capacity, byDate: new Map() }; raw.set(key, r); }
    const prev = r.byDate.get(q.quote_date);
    if (prev == null || q.cost_usd < prev) r.byDate.set(q.quote_date, q.cost_usd);
  }

  const products: ProductHistory[] = [];
  for (const [key, r] of raw) {
    const dates = [...r.byDate.keys()].sort();
    const series: DailyPoint[] = dates.map((date) => ({ date, cost: r.byDate.get(date)! }));
    const current = series[series.length - 1].cost;
    let min = Infinity, minDate = dates[0], max = -Infinity, maxDate = dates[0];
    for (const p of series) {
      if (p.cost < min) { min = p.cost; minDate = p.date; }
      if (p.cost > max) { max = p.cost; maxDate = p.date; }
    }
    const weekAgoTarget = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
    weekAgoTarget.setUTCDate(weekAgoTarget.getUTCDate() - 7);
    const weekAgoDate = closestOnOrBefore(dates.slice(0, -1), weekAgoTarget.toISOString().slice(0, 10));
    const weekAgo = weekAgoDate ? r.byDate.get(weekAgoDate)! : null;
    const pctVsWeek = weekAgo != null ? Math.round(((current - weekAgo) / weekAgo) * 1000) / 10 : null;

    products.push({ key, category: r.category, model: r.model, capacity: r.capacity, series, days: dates.length, current, min, minDate, max, maxDate, weekAgo, pctVsWeek });
  }

  // Una línea por (categoría, modelo): si hay más de una capacidad, la más chica es la representativa.
  const byModel = new Map<string, ProductHistory[]>();
  for (const p of products) {
    const k = `${p.category}|${p.model}`;
    const list = byModel.get(k) ?? [];
    list.push(p);
    byModel.set(k, list);
  }
  const lines: ModelLine[] = [...byModel.values()].map((list) => {
    const chosen = [...list].sort((a, b) => capacityGb(a.capacity) - capacityGb(b.capacity))[0];
    return { category: chosen.category, model: chosen.model, capacity: chosen.capacity, series: chosen.series };
  });

  return { totalDays, firstDate, allDates, products, lines };
}
