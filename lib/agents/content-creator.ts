import type { AgentModule } from "@/lib/agents/runtime";
import { reportsToday, latestReport } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { AGENTS } from "@/lib/agents";

/**
 * Content Creator (Agustina): 3 ideas de contenido por día, basadas en lo que pasó
 * hoy en el negocio (stock, mercado, competencia, precios), no en conceptos abstractos.
 * Evita repetir evitando lo que ya propuso la última vez que corrió en este contexto.
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
      (previous
        ? `Las ideas que ya diste la última vez (no las repitas):\n\n${previous.content_markdown}\n\n`
        : "") +
      `Dame las 3 ideas de contenido de hoy.`;

    const markdown = await askText({
      agent: "content-creator",
      role: "analyst",
      system: systemPrompt("content-creator"),
      prompt,
      usage: ctx.usage,
      maxTokens: 1800,
    });

    return {
      markdown,
      summary: `3 ideas · ${reports.length}/${sources.length} fuentes con datos de hoy`,
      data: { sources: sources.map((s) => s.id), reported: reports.map((r) => r.agent_name) },
    };
  },
};
