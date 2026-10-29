import type { AgentModule } from "@/lib/agents/runtime";
import { askWithWeb } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";

function weekdayArt(today: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long" }).format(
    new Date(`${today}T12:00:00-03:00`),
  );
}

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
      `Escribí el "Resumen de hoy": economía de EE.UU. (Fed, inflación, empleo, mercados), cripto (BTC/ETH y ` +
      `regulación relevante), guerras y geopolítica con efecto económico, y cualquier otra noticia económica ` +
      `mundial que importe hoy. Buscá y citá fuente y fecha de cada dato.` +
      (isWeekly
        ? `\n\nDespués agregá el "Resumen de la semana": mirá los últimos 7 días y marcá los 3 o 4 cambios de ` +
          `fondo (no un repaso día por día), y qué hay que mirar la semana que viene.`
        : "");

    const markdown = await askWithWeb({
      agent: "global-analyst",
      system: systemPrompt("global-analyst"),
      prompt,
      maxSearches: isWeekly ? 12 : 7,
      maxTokens: isWeekly ? 3000 : 1800,
      usage: ctx.usage,
    });

    return {
      markdown,
      summary: isWeekly ? "resumen diario + semanal de macro mundial" : "resumen diario de macro mundial",
      data: { weekly: isWeekly },
    };
  },
};
