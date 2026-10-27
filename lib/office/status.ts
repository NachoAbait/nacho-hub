import { AGENTS, type AgentStatus } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/**
 * Estado de cada agente para pintar la oficina.
 * - idle: todavía no está programado
 * - live: programado, sin output de hoy
 * - done: ya dejó su informe (o banner, en el caso del Designer) hoy
 */
export async function agentStatuses(): Promise<Record<string, AgentStatus>> {
  const db = supabaseAdmin();
  const today = todayArt();

  const [reports, banners] = await Promise.all([
    db.from("agent_reports").select("agent_name").eq("date", today),
    db.from("banners").select("generated_at").gte("generated_at", `${today}T00:00:00-03:00`).limit(1),
  ]);

  const reported = new Set((reports.data ?? []).map((r) => r.agent_name as string));
  const bannerToday = (banners.data ?? []).length > 0;

  const out: Record<string, AgentStatus> = {};
  for (const agent of AGENTS) {
    if (!agent.live) out[agent.id] = "idle";
    else if (agent.id === "designer") out[agent.id] = bannerToday ? "done" : "live";
    else out[agent.id] = reported.has(agent.id) ? "done" : "live";
  }
  return out;
}
