import type { AgentModule } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { computeStockReport } from "@/lib/stock-report";

/**
 * Stock Analyst (Julieta): rotación, margen y caja de NexiOS. Puro número + un informe de Claude
 * que prioriza las alertas; no toca precios ni el catálogo, solo informa. El cálculo (rows, caja,
 * capital inmovilizado) vive en lib/stock-report.ts, compartido con el panel visual del hub.
 */
export const stockAnalyst: AgentModule = {
  id: "stock-analyst",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY", "NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    const report = await computeStockReport();
    if (!report.available) {
      return {
        markdown: "# Stock y caja\n\nNo tengo acceso a NexiOS (falta la service role key, o no devolvió stock). No puedo calcular nada hoy.",
        summary: "sin conexión a NexiOS",
        data: {},
      };
    }

    const { rows, from, to, netCash, capitalTiedUp } = report;
    const dead = rows.filter((r) => r.units > 0 && r.soldUnits === 0 && r.agingDays > 30).sort((a, b) => b.costUsd - a.costUsd);
    const fastMovers = rows.filter((r) => r.sellThrough != null && r.sellThrough > 0.7 && r.units <= 2).sort((a, b) => (b.sellThrough ?? 0) - (a.sellThrough ?? 0));
    const aging60 = rows.filter((r) => r.units > 0 && r.agingDays > 60).sort((a, b) => b.agingDays - a.agingDays);

    const table = rows
      .map((r) => `${r.deviceType} | ${r.model}${r.capacity ? " " + r.capacity : ""} | stock ${r.units} (US$ ${Math.round(r.costUsd)}, ${r.agingDays}d) | vendidos 30d ${r.soldUnits} | sell-through ${r.sellThrough != null ? Math.round(r.sellThrough * 100) + "%" : "-"} | días de stock ${r.daysOfInventory != null ? Math.round(r.daysOfInventory) : "∞"}`)
      .join("\n");

    const prompt =
      `Datos de los últimos 30 días (${from} a ${to}), ya calculados — no inventes números, solo interpretalos:\n\n` +
      `Ventas: ${report.salesCount} operaciones.\n` +
      `Caja neta del período (ventas - gastos): US$ ${Math.round(netCash)}.\n` +
      `Capital inmovilizado en stock hoy: US$ ${Math.round(capitalTiedUp)} en ${report.unitsInStock} unidades.\n\n` +
      `Stock por modelo (formato: tipo | modelo | stock (costo, antigüedad) | vendidos 30d | sell-through | días de stock):\n${table}\n\n` +
      `Modelos sin ninguna venta en 30 días y con más de 30 días de stock: ${dead.length}.\n` +
      `Modelos que se agotan rápido (sell-through > 70%, quedan 2 o menos): ${fastMovers.length}.\n` +
      `Modelos con más de 60 días de antigüedad: ${aging60.length}.\n\n` +
      `Escribí el informe del día: máximo 5 alertas, las de más plata involucrada primero, cada una con el modelo, el número y la acción concreta (reponer, bajar precio, armar combo, liquidar).`;

    const markdown = await askText({ agent: "stock-analyst", role: "analyst", system: systemPrompt("stock-analyst"), prompt, usage: ctx.usage, maxTokens: 2000 });

    return {
      markdown,
      summary: `caja neta US$ ${Math.round(netCash)} · ${dead.length} sin rotar · ${fastMovers.length} se agotan`,
      data: { from, to, capitalTiedUp, netCash, dead: dead.length, fastMovers: fastMovers.length, aging60: aging60.length, rows: rows.length },
    };
  },
};
