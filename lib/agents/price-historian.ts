import type { AgentModule } from "@/lib/agents/runtime";
import { computePriceHistory, type ProductHistory } from "@/lib/price-history";
import { CATEGORY_LABEL } from "@/lib/types";

interface Insight extends ProductHistory {
  label: string;
  atAllTimeLow: boolean;
  atAllTimeHigh: boolean;
}

/** Con menos días que esto, cualquier "mínimo histórico" es trivial (el primer día que aparece ya
 * es mínimo Y máximo a la vez) — no vale la pena contarlo como si significara algo. */
const MIN_DAYS_FOR_TREND = 5;
/** Umbral de variación semanal para considerarlo un movimiento real y no ruido día a día. */
const WEEKLY_MOVE_PCT = 5;
/** Debajo de esto, toda lectura de estacionalidad (qué mes conviene comprar) es prematura. */
const MIN_DAYS_FOR_SEASONALITY = 60;

/**
 * Price Historian (Delfina): a diferencia de Martín (elige el proveedor más barato de HOY), ella
 * mira hacia atrás — cómo viene variando el costo de cada producto en el tiempo, usando las
 * cotizaciones que Lucas ya viene guardando día por día (price_quotes, nunca se borra). El detalle
 * (gráfico por categoría, mínimos/máximos, qué conviene stockear) vive en el panel visual del hub,
 * no en este informe: acá solo deja lo mínimo para que el Chief lo pueda mencionar en el Daily Brief.
 */
export const priceHistorian: AgentModule = {
  id: "price-historian",
  contexts: ["BNB"],
  async run(ctx) {
    const result = await computePriceHistory(ctx.db);
    if (!result.totalDays) {
      return { markdown: "Sin historial todavía.", summary: "sin datos", data: result };
    }

    const insights: Insight[] = result.products
      .filter((p) => p.days >= MIN_DAYS_FOR_TREND)
      .map((p) => ({
        ...p,
        label: `${CATEGORY_LABEL[p.category]}: ${p.model}${p.capacity ? " " + p.capacity : ""}`,
        atAllTimeLow: p.current <= p.min + 0.01 && p.min < p.max,
        atAllTimeHigh: p.current >= p.max - 0.01 && p.min < p.max,
      }));

    const lows = insights.filter((i) => i.atAllTimeLow);
    const highs = insights.filter((i) => i.atAllTimeHigh);
    const fallingFast = insights.filter((i) => i.pctVsWeek != null && i.pctVsWeek <= -WEEKLY_MOVE_PCT).sort((a, b) => (a.pctVsWeek ?? 0) - (b.pctVsWeek ?? 0));
    const risingFast = insights.filter((i) => i.pctVsWeek != null && i.pctVsWeek >= WEEKLY_MOVE_PCT).sort((a, b) => (b.pctVsWeek ?? 0) - (a.pctVsWeek ?? 0));

    const seasonalityNote = result.totalDays < MIN_DAYS_FOR_SEASONALITY
      ? ` Todavía poco historial (${result.totalDays} días) para estacionalidad real.`
      : "";
    const highlight = fallingFast[0] ? `${fallingFast[0].label} bajó ${fallingFast[0].pctVsWeek}% en la semana.` : null;

    return {
      markdown: `Historial de precios: ${lows.length} en mínimo histórico, ${highs.length} en máximo, ${fallingFast.length} bajando fuerte, ${risingFast.length} subiendo fuerte.${seasonalityNote}${highlight ? ` ${highlight}` : ""} Detalle y gráficos en el panel.`,
      summary: `${fallingFast.length} para stockear · ${risingFast.length} caros ahora`,
      data: { totalDays: result.totalDays, firstDate: result.firstDate, lows: lows.length, highs: highs.length, fallingFast: fallingFast.length, risingFast: risingFast.length },
    };
  },
};
