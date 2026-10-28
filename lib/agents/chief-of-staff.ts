import type { AgentModule } from "@/lib/agents/runtime";
import { reportsToday } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { AGENTS } from "@/lib/agents";

/**
 * Chief of Staff (Ernesto): lee los informes de hoy de todos los agentes operativos de este
 * contexto y arma el Daily Brief. No junta datos propios, no toca nada: solo lee y resume.
 */
export const chiefOfStaff: AgentModule = {
  id: "chief-of-staff",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const peers = AGENTS.filter((a) => a.live && a.id !== "chief-of-staff" && a.contexts.includes(ctx.context));
    if (!peers.length) {
      return {
        markdown: `# Daily Brief · ${ctx.context}\n\nTodavía no hay ningún agente operativo en este contexto.`,
        summary: "sin agentes para resumir",
        data: {},
      };
    }

    const reports = await reportsToday(ctx.db, peers.map((p) => p.id), ctx.context, ctx.today);
    const reportedIds = new Set(reports.map((r) => r.agent_name));
    const missing = peers.filter((p) => !reportedIds.has(p.id));

    const digest = reports
      .map((r) => {
        const agent = peers.find((p) => p.id === r.agent_name);
        return `### ${agent?.persona ?? r.agent_name} (${agent?.name ?? r.agent_name})\n${r.summary ? `Resumen corto: ${r.summary}\n` : ""}${r.content_markdown}`;
      })
      .join("\n\n---\n\n");

    const prompt =
      `Hoy es ${ctx.today}. Contexto: ${ctx.context}.\n\n` +
      `Informes de hoy (${reports.length} de ${peers.length} agentes operativos):\n\n${digest || "(ninguno reportó todavía)"}\n\n` +
      (missing.length ? `Agentes operativos que NO reportaron hoy: ${missing.map((m) => `${m.persona} (${m.name})`).join(", ")}.\n\n` : "") +
      `Armá el Daily Brief de hoy.`;

    const markdown = await askText({
      agent: "chief-of-staff",
      role: "analyst",
      system: systemPrompt("chief-of-staff"),
      prompt,
      usage: ctx.usage,
      maxTokens: 2000,
    });

    return {
      markdown,
      summary: `Daily Brief listo · ${reports.length}/${peers.length} agentes reportaron`,
      data: { reported: reports.map((r) => r.agent_name), missing: missing.map((m) => m.id) },
    };
  },
};
