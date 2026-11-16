import { z } from "zod";
import type { AgentModule } from "@/lib/agents/runtime";
import { askJson, askWithWeb } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";

const ReferenceSchema = z.object({
  source: z.string(),
  hook: z.string(),
  whyItWorked: z.string(),
});
const FindingsSchema = z.object({
  foundReferences: z.boolean(),
  references: z.array(ReferenceSchema).max(6),
  patterns: z.array(z.string()).max(5),
  /** Qué puede hacer Nacho hoy mismo, exista o no un hallazgo verificable. */
  todayAction: z.string(),
});
export type ReelScoutFindings = z.infer<typeof FindingsSchema>;

/**
 * Reel Scout (Renata): Reader diario que investiga qué reels virales hay en el nicho Apple/iPhone
 * y por qué funcionan. No scrapea directo (Instagram bloquea): usa la búsqueda web de Claude y cita
 * fuentes. Content Creator lee este informe cada día para proponer reels propios. Solo informa.
 *
 * Dos pasadas: la primera busca y escribe en prosa (necesita la tool de búsqueda web); la segunda
 * (Haiku, barata) estructura esa prosa en tarjetas — el panel (ver ReelScoutPanel) nunca muestra
 * markdown crudo, siempre referencias/patrones como cards, igual que el resto de los Readers.
 */
export const reelScout: AgentModule = {
  id: "reel-scout",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const prompt =
      `Contexto: ${ctx.context}. Hoy es ${ctx.today}.\n\n` +
      `Buscá vos misma (en TikTok, YouTube Shorts y notas de marketing — Instagram está bloqueado, no lo intentes ahí) ` +
      `reels y videos cortos virales del último mes en el nicho de reventa de celulares y mundo Apple/iPhone ` +
      `(Argentina y Latinoamérica primero, después global si hace falta). Para cada referencia: fuente, hook, estructura, ritmo y por qué funcionó. ` +
      `Si una búsqueda no da resultados, probá otra query vos misma antes de rendirte — no le dejes esa tarea a Nacho. ` +
      `Cerrá con los patrones que se repiten y cómo BNB Store podría hacer algo propio con ellos.`;

    const research = await askWithWeb({
      agent: "reel-scout",
      system: systemPrompt("reel-scout"),
      prompt,
      maxSearches: 12,
      maxTokens: 3000,
      usage: ctx.usage,
    });

    const findings = await askJson({
      agent: "reel-scout-structurer",
      role: "parser",
      system:
        "Convertís el informe de un analista de contenido viral a JSON. No inventes nada que no esté en el texto: " +
        "si el texto dice que no encontró referencias verificables, foundReferences=false y references=[].",
      prompt: `Informe a estructurar:\n\n${research}`,
      schema: FindingsSchema,
      usage: ctx.usage,
      maxTokens: 1200,
    });

    return {
      markdown: research,
      summary: findings.foundReferences
        ? `${findings.references.length} referencia(s), ${findings.patterns.length} patrón(es)`
        : "sin referencias verificables hoy",
      data: findings,
    };
  },
};
