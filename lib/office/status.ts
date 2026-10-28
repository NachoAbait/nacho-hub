import { AGENTS, TIER_WINDOW, type AgentStatus } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/** Hora actual en ART como número decimal (7.5 = 07:30). */
function hourArt(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/**
 * Estado de cada agente para pintar la oficina.
 * - idle: todavía no está programado
 * - working: está en su ventana horaria del cron y todavía no dejó output
 * - done: ya dejó su informe (o banner, en el caso del Designer) hoy
 * - live: programado, fuera de horario, sin output de hoy
 */
export async function agentStatuses(): Promise<Record<string, AgentStatus>> {
  const db = supabaseAdmin();
  const today = todayArt();

  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [reports, banners, running] = await Promise.all([
    db.from("agent_reports").select("agent_name").eq("date", today),
    db.from("banners").select("generated_at").gte("generated_at", `${today}T00:00:00-03:00`).limit(1),
    db.from("agent_runs").select("agent_id").eq("status", "running").gte("started_at", tenMinAgo),
  ]);
  const runningNow = new Set((running.data ?? []).map((r) => r.agent_id as string));

  const reported = new Set((reports.data ?? []).map((r) => r.agent_name as string));
  const bannerToday = (banners.data ?? []).length > 0;

  const hour = hourArt();
  const out: Record<string, AgentStatus> = {};
  for (const agent of AGENTS) {
    if (!agent.live) {
      out[agent.id] = "idle";
      continue;
    }
    if (runningNow.has(agent.id)) {
      out[agent.id] = "working";
      continue;
    }
    const done = agent.id === "designer" ? bannerToday : reported.has(agent.id);
    const [from, to] = TIER_WINDOW[agent.tier];
    out[agent.id] = done ? "done" : hour >= from && hour < to ? "working" : "live";
  }
  return out;
}
