import { z } from "zod";
import type { AgentModule } from "@/lib/agents/runtime";
import { reportsToday, latestReport } from "@/lib/agents/runtime";
import { askJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { AGENTS } from "@/lib/agents";

const IdeaSchema = z.object({
  format: z.string(),
  hook: z.string(),
  steps: z.array(z.string()).length(3),
  cta: z.string(),
  needs: z.string(),
});
const IdeasSchema = z.object({ context: z.string(), ideas: z.array(IdeaSchema).length(3) });

/**
 * Content Creator (Agustina): 3 ideas de contenido por día, basadas en lo que pasó
 * hoy en el negocio (stock, mercado, competencia, precios), no en conceptos abstractos.
 * Evita repetir evitando lo que ya propuso la última vez que corrió en este contexto.
 * Devuelve JSON estructurado para que el panel las muestre como tarjetas, no como texto.
 */
export const contentCreator: AgentModule = {
  id: "content-creator",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const sources = AGENTS.filter(
      (a) => a.live && ["readers", "analysts"].includes(a.tier) && a.contexts.includes(ctx.context) && a.id !== "content-creator",
    );
    const reports = await reportsToday(ctx.db, sources.map((s) => s.id), ctx.context, ctx.today);
    const digest = reports
      .map((r) => {
        const agent = sources.find((s) => s.id === r.agent_name);
        return `### ${agent?.persona ?? r.agent_name} (${agent?.name ?? r.agent_name})\n${r.summary ? `${r.summary}\n` : ""}${r.content_markdown}`;
      })
      .join("\n\n---\n\n");

    const previous = await latestReport(ctx.db, "content-creator", ctx.context);

    const prompt =
      `Contexto: ${ctx.context}. Hoy es ${ctx.today}.\n\n` +
      `Lo que pasó hoy en el negocio, según los otros agentes (${reports.length} de ${sources.length} reportaron):\n\n` +
      `${digest || "(ninguno reportó todavía hoy, trabajá con lo que sabés del negocio en general)"}\n\n` +
      (previous?.raw_data_json
        ? `Las ideas que ya diste la última vez (no las repitas): ${JSON.stringify(previous.raw_data_json)}\n\n`
        : "") +
      `Dame las 3 ideas de contenido de hoy, cada una con formato, gancho, guion en exactamente 3 pasos, llamada a la acción, y qué se necesita para grabarla.`;

    const result = await askJson({
      agent: "content-creator",
      role: "analyst",
      system: systemPrompt("content-creator"),
      prompt,
      schema: IdeasSchema,
      usage: ctx.usage,
      maxTokens: 1800,
    });

    const markdown = result.ideas
      .map((idea, i) => `## ${i + 1}. ${idea.format}\n**Gancho:** ${idea.hook}\n\n${idea.steps.map((s, j) => `${j + 1}. ${s}`).join("\n")}\n\n**CTA:** ${idea.cta}\n**Necesitás:** ${idea.needs}`)
      .join("\n\n");

    return {
      markdown: `# Ideas de contenido · ${ctx.today}\n\n${markdown}`,
      summary: `3 ideas · ${reports.length}/${sources.length} fuentes con datos de hoy`,
      data: { ideas: result.ideas, sources: sources.map((s) => s.id), reported: reports.map((r) => r.agent_name) },
    };
  },
};
