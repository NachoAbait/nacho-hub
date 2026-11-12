import type { AgentModule } from "@/lib/agents/runtime";
import { entryKey } from "@/lib/agents/catalog-match";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

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

interface ProductHistory {
  category: Category;
  label: string;
  byDate: Map<string, number>;
}

interface Insight {
  label: string;
  days: number;
  current: number;
  min: number;
  minDate: string;
  max: number;
  maxDate: string;
  weekAgo: number | null;
  pctVsWeek: number | null;
  atAllTimeLow: boolean;
  atAllTimeHigh: boolean;
}

/** Con menos días que esto, cualquier "mínimo histórico" es trivial (el primer día que aparece ya
 * es mínimo Y máximo a la vez) — no vale la pena mostrarlo como si significara algo. */
const MIN_DAYS_FOR_TREND = 5;
/** Umbral de variación semanal para considerarlo un movimiento real y no ruido día a día. */
const WEEKLY_MOVE_PCT = 5;
/** Debajo de esto, toda lectura de estacionalidad (qué mes conviene comprar) es prematura. */
const MIN_DAYS_FOR_SEASONALITY = 60;

function fmtLabel(category: Category, model: string, capacity: string | null): string {
  return `${CATEGORY_LABEL[category]}: ${model}${capacity ? " " + capacity : ""}`;
}

/** El día con dato más cercano, hacia atrás, a `target` (hace ~7 días puede no tener cotización). */
function closestOnOrBefore(dates: string[], target: string): string | null {
  let best: string | null = null;
  for (const d of dates) if (d <= target) best = d;
  return best;
}

/**
 * Price Historian (Delfina): a diferencia de Martín (elige el proveedor más barato de HOY), ella
 * mira hacia atrás — cómo viene variando el costo de cada producto en el tiempo, usando las
 * cotizaciones que Lucas ya viene guardando día por día (price_quotes, nunca se borra). Con pocos
 * meses de historial todavía no puede hablar de estacionalidad real (qué mes conviene stockear),
 * pero sí puede avisar cuándo algo está en su precio más bajo/alto desde que hay registro, o
 * moviéndose fuerte en la última semana — y esa lectura se va a ir poniendo más fina sola, sin
 * tocar código, a medida que se acumulen más días.
 */
export const priceHistorian: AgentModule = {
  id: "price-historian",
  contexts: ["BNB"],
  async run(ctx) {
    const { data: quotes, error } = await ctx.db
      .from("price_quotes")
      .select("category, model, chip, cellular, inches, screen_mm, capacity, cost_usd, quote_date")
      .returns<QuoteRow[]>();
    if (error) throw new Error(`price_quotes: ${error.message}`);

    if (!quotes?.length) {
      return {
        markdown: "# Variación de precios\n\nTodavía no hay cotizaciones guardadas para armar historial.",
        summary: "sin datos",
        data: { totalDays: 0 },
      };
    }

    const distinctDays = [...new Set(quotes.map((q) => q.quote_date))].sort();
    const totalDays = distinctDays.length;
    const firstDate = distinctDays[0];

    // Por producto normalizado (misma clave que usa Martín), el costo más barato de cada día entre
    // todos los proveedores que lo cotizaron ese día.
    const histories = new Map<string, ProductHistory>();
    for (const q of quotes) {
      const key = entryKey(q.category, q.model, q.capacity, q.chip, q.inches, q.cellular, q.screen_mm);
      let h = histories.get(key);
      if (!h) {
        h = { category: q.category, label: fmtLabel(q.category, q.model, q.capacity), byDate: new Map() };
        histories.set(key, h);
      }
      const prev = h.byDate.get(q.quote_date);
      if (prev == null || q.cost_usd < prev) h.byDate.set(q.quote_date, q.cost_usd);
    }

    const insights: Insight[] = [];
    for (const h of histories.values()) {
      const dates = [...h.byDate.keys()].sort();
      if (dates.length < MIN_DAYS_FOR_TREND) continue;
      const current = h.byDate.get(dates[dates.length - 1])!;
      let min = Infinity, minDate = dates[0], max = -Infinity, maxDate = dates[0];
      for (const d of dates) {
        const v = h.byDate.get(d)!;
        if (v < min) { min = v; minDate = d; }
        if (v > max) { max = v; maxDate = d; }
      }
      const weekAgoTarget = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
      weekAgoTarget.setUTCDate(weekAgoTarget.getUTCDate() - 7);
      const weekAgoDate = closestOnOrBefore(dates.slice(0, -1), weekAgoTarget.toISOString().slice(0, 10));
      const weekAgo = weekAgoDate ? h.byDate.get(weekAgoDate)! : null;
      const pctVsWeek = weekAgo != null ? Math.round(((current - weekAgo) / weekAgo) * 1000) / 10 : null;

      insights.push({
        label: h.label, days: dates.length, current, min, minDate, max, maxDate, weekAgo, pctVsWeek,
        atAllTimeLow: current <= min + 0.01 && min < max,
        atAllTimeHigh: current >= max - 0.01 && min < max,
      });
    }

    const lows = insights.filter((i) => i.atAllTimeLow).sort((a, b) => b.days - a.days);
    const highs = insights.filter((i) => i.atAllTimeHigh).sort((a, b) => b.days - a.days);
    const fallingFast = insights.filter((i) => i.pctVsWeek != null && i.pctVsWeek <= -WEEKLY_MOVE_PCT).sort((a, b) => (a.pctVsWeek ?? 0) - (b.pctVsWeek ?? 0));
    const risingFast = insights.filter((i) => i.pctVsWeek != null && i.pctVsWeek >= WEEKLY_MOVE_PCT).sort((a, b) => (b.pctVsWeek ?? 0) - (a.pctVsWeek ?? 0));

    const lines: string[] = ["# Variación de precios"];
    lines.push("", `Historial: ${totalDays} día${totalDays === 1 ? "" : "s"} de cotizaciones, desde el ${firstDate}.`);
    if (totalDays < MIN_DAYS_FOR_SEASONALITY) {
      lines.push("Todavía es poco para hablar de estacionalidad (qué mes del año conviene comprar): hace falta varios meses de historial real. Mientras tanto, esto es lo que ya se puede ver con lo que hay — y se va a ir poniendo más fino solo, a medida que se acumulen más días.");
    }

    // Con pocos días de historial, si el mercado viene bajando en general, CASI todo lo que tiene
    // historial queda "en su mínimo" a la vez — eso no distingue nada, solo repite la tendencia
    // general. Ahí conviene una sola línea en vez de empapelar el informe con 20+ ítems.
    const MAX_LIST = 8;
    const NOISY_SHARE = 0.5;
    const renderExtremes = (label: string, list: Insight[], fmt: (i: Insight) => string) => {
      if (!list.length) return;
      lines.push("", `## ${label}`);
      if (insights.length >= MIN_DAYS_FOR_TREND && list.length / insights.length >= NOISY_SHARE) {
        lines.push(`- ${list.length} de ${insights.length} productos con historial — la mayoría, todavía normal a pocos días de empezar a medir, no distingue nada en particular.`);
        return;
      }
      for (const i of list.slice(0, MAX_LIST)) lines.push(`- ${fmt(i)}`);
      if (list.length > MAX_LIST) lines.push(`- … y ${list.length - MAX_LIST} más.`);
    };

    renderExtremes("Al precio más bajo desde que hay registro", lows, (i) => `**${i.label}**: US$ ${i.current} (llegó a US$ ${i.max} el ${i.maxDate}) · ${i.days} días de historial`);
    renderExtremes("Al precio más alto desde que hay registro", highs, (i) => `**${i.label}**: US$ ${i.current} (el más bajo fue US$ ${i.min} el ${i.minDate}) · ${i.days} días de historial`);
    if (fallingFast.length) {
      lines.push("", "## Bajando fuerte en la última semana");
      for (const i of fallingFast.slice(0, MAX_LIST)) lines.push(`- **${i.label}**: ${i.pctVsWeek}% (US$ ${i.weekAgo} → US$ ${i.current})`);
      if (fallingFast.length > MAX_LIST) lines.push(`- … y ${fallingFast.length - MAX_LIST} más.`);
    }
    if (risingFast.length) {
      lines.push("", "## Subiendo fuerte en la última semana");
      for (const i of risingFast.slice(0, MAX_LIST)) lines.push(`- **${i.label}**: +${i.pctVsWeek}% (US$ ${i.weekAgo} → US$ ${i.current})`);
      if (risingFast.length > MAX_LIST) lines.push(`- … y ${risingFast.length - MAX_LIST} más.`);
    }
    if (!lows.length && !highs.length && !fallingFast.length && !risingFast.length) {
      lines.push("", `Nada para destacar todavía: ${insights.length} producto${insights.length === 1 ? "" : "s"} con suficiente historial (${MIN_DAYS_FOR_TREND}+ días), sin movimientos grandes esta semana.`);
    }

    lines.push("", "## Para hoy");
    if (fallingFast.length) lines.push(`- Buen momento para stockear ${fallingFast.length === 1 ? fallingFast[0].label : `${fallingFast.length} modelos`}: vienen bajando fuerte.`);
    if (risingFast.length) lines.push(`- Ojo antes de cargar stock de ${risingFast.length === 1 ? risingFast[0].label : `${risingFast.length} modelos`}: vienen subiendo fuerte.`);
    if (!fallingFast.length && !risingFast.length) lines.push("- Nada urgente: los precios se mantuvieron estables esta semana.");

    const summary = insights.length === 0
      ? `solo ${totalDays} día${totalDays === 1 ? "" : "s"} de historial todavía`
      : `${lows.length} en mínimo histórico · ${highs.length} en máximo · ${fallingFast.length} bajando · ${risingFast.length} subiendo`;

    return {
      markdown: lines.join("\n"),
      summary,
      data: { totalDays, firstDate, insights },
    };
  },
};
