import type { AgentModule } from "@/lib/agents/runtime";
import { askWithWeb } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";

/**
 * Reel Scout (Renata): Reader diario que investiga qué reels virales hay en el nicho Apple/iPhone
 * y por qué funcionan. No scrapea directo (Instagram bloquea): usa la búsqueda web de Claude y cita
 * fuentes. Content Creator lee este informe cada día para proponer reels propios. Solo informa.
 */
export const reelScout: AgentModule = {
  id: "reel-scout",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const prompt =
      `Contexto: ${ctx.context}. Hoy es ${ctx.today}.\n\n` +
      `Buscá reels y videos cortos virales de las últimas dos semanas en el nicho de reventa de celulares y mundo Apple/iPhone ` +
      `(Argentina y Latinoamérica primero). Para cada referencia: fuente, hook, estructura, ritmo y por qué funcionó. ` +
      `Cerrá con los patrones que se repiten y cómo BNB Store podría hacer algo propio con ellos.`;

    const markdown = await askWithWeb({
      agent: "reel-scout",
      system: systemPrompt("reel-scout"),
      prompt,
      maxSearches: 6,
      maxTokens: 2500,
      usage: ctx.usage,
    });

    return {
      markdown,
      summary: "investigó reels virales del nicho Apple/iPhone",
      data: { niche: "apple-iphone-reventa" },
    };
  },
};
