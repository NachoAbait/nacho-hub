import type { AgentModule } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { computeMarketReport } from "@/lib/market-report";

/**
 * Market Watcher (Tomás): dólar del día + noticias relevantes, un resumen por contexto.
 * Dólar de dolarapi.com (sin key), noticias de Google News RSS (sin key). Solo informa, no toca nada.
 * El fetch vive en lib/market-report.ts, compartido con el panel visual del hub.
 */
export const marketWatcher: AgentModule = {
  id: "market-watcher",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const { dolares, news } = await computeMarketReport(ctx.context);

    const dolarText = dolares.length
      ? dolares.map((d) => `${d.nombre}: compra $${d.compra} / venta $${d.venta}`).join("\n")
      : "No pude leer la cotización del dólar hoy (dolarapi.com no respondió).";
    const newsText = news.length ? news.map((n) => `- ${n.title}`).join("\n") : "No encontré titulares relevantes hoy.";

    const prompt =
      `Contexto: ${ctx.context}.\n\n` +
      `Cotizaciones del dólar de hoy (${ctx.today}):\n${dolarText}\n\n` +
      `Titulares de las últimas horas, de varias búsquedas (puede haber ruido, filtralo vos):\n${newsText}\n\n` +
      `Escribí el resumen de mercado del día.`;

    const markdown = await askText({
      agent: "market-watcher",
      role: "analyst",
      system: systemPrompt("market-watcher"),
      prompt,
      usage: ctx.usage,
      maxTokens: 1500,
    });

    const blue = dolares.find((d) => d.casa === "blue");
    return {
      markdown,
      summary: blue ? `dólar blue US$ ${blue.venta} · ${news.length} noticias revisadas` : `${news.length} noticias revisadas`,
      data: { dolares, news },
    };
  },
};
