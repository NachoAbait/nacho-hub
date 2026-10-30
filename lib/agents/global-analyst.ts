import { z } from "zod";
import type { AgentModule } from "@/lib/agents/runtime";
import { askWithWeb, askJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";

function weekdayArt(today: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long" }).format(
    new Date(`${today}T12:00:00-03:00`),
  );
}

const HighlightsSchema = z.object({
  highlights: z.array(z.object({ label: z.string(), value: z.string() })).max(6),
});

/**
 * Global Analyst (Mateo): resumen diario de macro mundial (EE.UU., cripto, geopolítica, actualidad
 * económica global). Los domingos agrega también el resumen de la semana. Piso propio: no vende nada,
 * solo informa; si algo del mundo pega directo en BNB o AgroScan, lo marca en una línea.
 */
export const globalAnalyst: AgentModule = {
  id: "global-analyst",
  contexts: ["GLOBAL"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const isWeekly = weekdayArt(ctx.today) === "Sunday";

    const prompt =
      `Hoy es ${ctx.today}.\n\n` +
      `Escribí el "Resumen de hoy". Tenés ${isWeekly ? 18 : 10} búsquedas disponibles: repartilas entre estos ` +
      `cuatro temas, 2 o 3 cada uno, no las gastes todas en el primero:\n` +
      `1. Economía de EE.UU.: Fed (tasas, próxima reunión), inflación, empleo, S&P 500 / Nasdaq.\n` +
      `2. Cripto: precio de Bitcoin y Ethereum hoy, regulación relevante.\n` +
      `3. Guerras y geopolítica con efecto económico (energía, granos, rutas comerciales, sanciones).\n` +
      `4. Agenda económica mundial del día (comercio, aranceles, commodities, bancos centrales fuera de EE.UU.).\n\n` +
      `Citá fuente y fecha de cada dato. Si un tema no tiene nada nuevo hoy, decilo en una línea y seguí.` +
      (isWeekly
        ? `\n\nDespués agregá el "Resumen de la semana": mirá los últimos 7 días y marcá los 3 o 4 cambios de ` +
          `fondo (no un repaso día por día), y qué hay que mirar la semana que viene.`
        : "");

    const markdown = await askWithWeb({
      agent: "global-analyst",
      system: systemPrompt("global-analyst"),
      prompt,
      maxSearches: isWeekly ? 18 : 10,
      maxTokens: isWeekly ? 3600 : 3000,
      usage: ctx.usage,
    });

    // Segunda pasada, chica y barata: saca 4-6 datos sueltos del informe para mostrar como tarjetas
    // arriba del panel (dólar, BTC, Fed...). El informe completo con fuentes sigue abajo, intacto.
    let highlights: { label: string; value: string }[] = [];
    try {
      const extracted = await askJson({
        agent: "global-analyst-highlights",
        role: "parser",
        system: "Extraé los 4 a 6 datos numéricos más importantes de este informe (cotizaciones, tasas, índices), como pares corto label/value. No inventes nada que no esté en el texto.",
        prompt: markdown,
        schema: HighlightsSchema,
        usage: ctx.usage,
        maxTokens: 500,
      });
      highlights = extracted.highlights;
    } catch {
      // Si falla la extracción, el panel se apoya en el markdown completo igual.
    }

    return {
      markdown,
      summary: isWeekly ? "resumen diario + semanal de macro mundial" : "resumen diario de macro mundial",
      data: { weekly: isWeekly, highlights },
    };
  },
};
