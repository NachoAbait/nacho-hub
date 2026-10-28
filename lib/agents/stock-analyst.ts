import type { AgentModule } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { fetchExpenses, fetchSales, fetchStock, nexiosAvailable, normalizeCapacity, normalizeModel } from "@/lib/nexios";

function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function daysAgoArt(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
}

interface Row {
  model: string;
  capacity: string | null;
  deviceType: string;
  units: number;
  costUsd: number;
  priceUsd: number | null;
  agingDays: number;
  soldUnits: number;
  revenueUsd: number;
  sellThrough: number | null;
  daysOfInventory: number | null;
}

/**
 * Stock Analyst (Julieta): rotación, margen y caja de NexiOS. Puro número + un informe de Claude
 * que prioriza las alertas; no toca precios ni el catálogo, solo informa.
 */
export const stockAnalyst: AgentModule = {
  id: "stock-analyst",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY", "NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    if (!nexiosAvailable()) {
      return {
        markdown: "# Stock y caja\n\nNo tengo acceso a NexiOS (falta la service role key). No puedo calcular nada hoy.",
        summary: "sin conexión a NexiOS",
        data: {},
      };
    }

    const today = todayArt();
    const from = daysAgoArt(30);
    const [sales, stock, expenses] = await Promise.all([fetchSales(from, today), fetchStock(), fetchExpenses(from, today)]);
    if (!stock) {
      return { markdown: "# Stock y caja\n\nNexiOS no devolvió stock. Reintento en la próxima corrida.", summary: "sin datos de stock", data: {} };
    }

    // Empareja stock con ventas de 30 días por modelo+capacidad normalizados (mismo criterio que el Price Reader).
    const soldByKey = new Map<string, { units: number; revenue: number }>();
    for (const s of sales?.by_model ?? []) {
      const m = s.model.match(/^(.*?)(?:\s+(\d+\s?(?:gb|tb)))?$/i);
      const key = `${normalizeModel(m?.[1] ?? s.model)}|${normalizeCapacity(m?.[2] ?? null)}`;
      const cur = soldByKey.get(key) ?? { units: 0, revenue: 0 };
      cur.units += s.units;
      cur.revenue += s.revenue_usd;
      soldByKey.set(key, cur);
    }

    const rows: Row[] = stock.map((p) => {
      const key = `${normalizeModel(p.model)}|${normalizeCapacity(p.capacity)}`;
      const sold = soldByKey.get(key) ?? { units: 0, revenue: 0 };
      const agingDays = Math.round((Date.now() - new Date(p.oldest_entry + "T00:00:00-03:00").getTime()) / 86400_000);
      const sellThrough = p.units + sold.units > 0 ? sold.units / (p.units + sold.units) : null;
      const dailyRate = sold.units / 30;
      const daysOfInventory = dailyRate > 0 ? p.units / dailyRate : null;
      return {
        model: p.model, capacity: p.capacity, deviceType: p.device_type, units: p.units, costUsd: p.cost_usd,
        priceUsd: p.price_usd, agingDays, soldUnits: sold.units, revenueUsd: sold.revenue, sellThrough, daysOfInventory,
      };
    });

    const capitalTiedUp = rows.reduce((n, r) => n + r.costUsd, 0);
    const dead = rows.filter((r) => r.units > 0 && r.soldUnits === 0 && r.agingDays > 30).sort((a, b) => b.costUsd - a.costUsd);
    const fastMovers = rows.filter((r) => r.sellThrough != null && r.sellThrough > 0.7 && r.units <= 2).sort((a, b) => (b.sellThrough ?? 0) - (a.sellThrough ?? 0));
    const aging60 = rows.filter((r) => r.units > 0 && r.agingDays > 60).sort((a, b) => b.agingDays - a.agingDays);
    const netCash = (sales?.revenue_usd ?? 0) - (expenses?.total_usd ?? 0);

    const table = rows
      .filter((r) => r.units > 0 || r.soldUnits > 0)
      .map((r) => `${r.deviceType} | ${r.model}${r.capacity ? " " + r.capacity : ""} | stock ${r.units} (US$ ${Math.round(r.costUsd)}, ${r.agingDays}d) | vendidos 30d ${r.soldUnits} | sell-through ${r.sellThrough != null ? Math.round(r.sellThrough * 100) + "%" : "-"} | días de stock ${r.daysOfInventory != null ? Math.round(r.daysOfInventory) : "∞"}`)
      .join("\n");

    const prompt =
      `Datos de los últimos 30 días (${from} a ${today}), ya calculados — no inventes números, solo interpretalos:\n\n` +
      `Ventas: ${sales?.sales_count ?? 0} operaciones, US$ ${Math.round(sales?.revenue_usd ?? 0)} facturados, ${sales?.trade_ins ?? 0} con canje.\n` +
      `Gastos del período: US$ ${Math.round(expenses?.total_usd ?? 0)}.\n` +
      `Caja neta del período (ventas - gastos): US$ ${Math.round(netCash)}.\n` +
      `Capital inmovilizado en stock hoy: US$ ${Math.round(capitalTiedUp)} en ${rows.reduce((n, r) => n + r.units, 0)} unidades.\n\n` +
      `Stock por modelo (formato: tipo | modelo | stock (costo, antigüedad) | vendidos 30d | sell-through | días de stock):\n${table}\n\n` +
      `Modelos sin ninguna venta en 30 días y con más de 30 días de stock: ${dead.length}.\n` +
      `Modelos que se agotan rápido (sell-through > 70%, quedan 2 o menos): ${fastMovers.length}.\n` +
      `Modelos con más de 60 días de antigüedad: ${aging60.length}.\n\n` +
      `Escribí el informe del día: máximo 5 alertas, las de más plata involucrada primero, cada una con el modelo, el número y la acción concreta (reponer, bajar precio, armar combo, liquidar).`;

    const markdown = await askText({ agent: "stock-analyst", role: "analyst", system: systemPrompt("stock-analyst"), prompt, usage: ctx.usage, maxTokens: 2000 });

    return {
      markdown,
      summary: `caja neta US$ ${Math.round(netCash)} · ${dead.length} sin rotar · ${fastMovers.length} se agotan`,
      data: { from, to: today, capitalTiedUp, netCash, dead: dead.length, fastMovers: fastMovers.length, aging60: aging60.length, rows: rows.length },
    };
  },
};
