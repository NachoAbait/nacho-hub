import { z } from "zod";
import type { AgentModule } from "@/lib/agents/runtime";
import { getSetting } from "@/lib/agents/runtime";
import { askWithWeb, askJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import type { BusinessContext } from "@/lib/types";

const FALLBACK_QUERIES: Record<BusinessContext, string[]> = {
  BNB: [
    "iPhone precio Dolores Buenos Aires Instagram",
    "reventa Apple Chascomús Castelli Lezama precio",
  ],
  AgroScan: ["software gestión ganadera Argentina precio caravanas electrónicas"],
  GLOBAL: [],
};

const PricesSchema = z.object({
  prices: z.array(z.object({ competitor: z.string(), item: z.string(), price: z.string() })).max(8),
});

/**
 * Competitor Scraper (Sofía): investiga precios y movimientos de la competencia.
 * No scrapea directo (Instagram/MercadoLibre bloquean eso): usa la herramienta nativa
 * de búsqueda web de Claude, que explora y cita fuentes sola. Solo informa, no toca nada.
 */
export const competitorScraper: AgentModule = {
  id: "competitor-scraper",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const competitors = await getSetting<Record<BusinessContext, string[]>>(ctx.db, "competitors", {
      BNB: [],
      AgroScan: [],
      GLOBAL: [],
    });
    const named = competitors[ctx.context] ?? [];
    const seeds = named.length ? named.map((c) => `"${c}"`).join(", ") : FALLBACK_QUERIES[ctx.context].join(" / ");

    const prompt =
      `Contexto: ${ctx.context}. Hoy es ${ctx.today}.\n\n` +
      (named.length
        ? `Competidores a investigar primero: ${seeds}.\n\n`
        : `Todavía no hay una lista curada de competidores para este contexto. Buscá con estas pistas: ${seeds}.\n\n`) +
      `Investigá precios actuales, promos y movimientos de la última semana. Citá la fuente de cada dato.`;

    const markdown = await askWithWeb({
      agent: "competitor-scraper",
      system: systemPrompt("competitor-scraper"),
      prompt,
      maxSearches: 6,
      maxTokens: 2000,
      usage: ctx.usage,
    });

    // Segunda pasada, chica y barata: saca la tabla de precios comparables del informe para mostrarla
    // como tarjetas arriba del panel. El informe completo con fuentes sigue abajo, intacto.
    let prices: { competitor: string; item: string; price: string }[] = [];
    try {
      const extracted = await askJson({
        agent: "competitor-scraper-prices",
        role: "parser",
        system: "Extraé del informe la tabla de precios comparables (competidor, producto, precio). Si no hay ninguno con precio y fuente claros, devolvé una lista vacía: no inventes.",
        prompt: markdown,
        schema: PricesSchema,
        usage: ctx.usage,
        maxTokens: 500,
      });
      prices = extracted.prices;
    } catch {
      // Si falla la extracción, el panel se apoya en el markdown completo igual.
    }

    return {
      markdown,
      summary: named.length ? `investigó ${named.length} competidores` : "investigó el mercado sin lista curada todavía",
      data: { competitors: named, prices },
    };
  },
};
