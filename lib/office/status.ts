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
 * - working: está corriendo de verdad ahora, o está en su ventana horaria del cron sin output todavía
 * - done: ya dejó su informe (o banner, en el caso del Designer) hoy
 * - live: programado, fuera de horario, sin output de hoy
 */
export async function agentStatuses(): Promise<Record<string, AgentStatus>> {
  const db = supabaseAdmin();
  const today = todayArt();

  // Una corrida real (ingest o cron) tarda entre 20 y 60 segundos: una ventana de "sigue corriendo"
  // de varios minutos deja que una corrida colgada (el proceso muere a mitad de camino y nunca llega
  // a marcar ok/error en la tabla) tape durante mucho rato que el agente ya terminó de verdad.
  const runningCutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  // "Recién activo": Lucas nunca "termina" (sigue escuchando todo el día), pero apenas leyó algo
  // tiene que verse distinto de "en espera" como si no hubiera pasado nada.
  const recentCutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  const [reports, banners, running] = await Promise.all([
    db.from("agent_reports").select("agent_name, created_at").eq("date", today).returns<{ agent_name: string; created_at: string }[]>(),
    db.from("banners").select("generated_at").gte("generated_at", `${today}T00:00:00-03:00`).limit(1),
    db.from("agent_runs").select("agent_id, started_at").eq("status", "running").gte("started_at", runningCutoff).returns<{ agent_id: string; started_at: string }[]>(),
  ]);

  const latestReportAt = new Map<string, string>();
  for (const r of reports.data ?? []) {
    const prev = latestReportAt.get(r.agent_name);
    if (!prev || r.created_at > prev) latestReportAt.set(r.agent_name, r.created_at);
  }
  const runningSince = new Map<string, string>();
  for (const r of running.data ?? []) {
    const prev = runningSince.get(r.agent_id);
    if (!prev || r.started_at > prev) runningSince.set(r.agent_id, r.started_at);
  }
  const bannerToday = (banners.data ?? []).length > 0;

  const hour = hourArt();
  const out: Record<string, AgentStatus> = {};
  for (const agent of AGENTS) {
    if (!agent.live) {
      out[agent.id] = "idle";
      continue;
    }

    const since = runningSince.get(agent.id);
    const lastReport = latestReportAt.get(agent.id);
    // Zombie: si ya hay un informe generado DESPUÉS de que arrancó esta corrida "running", esa
    // corrida se colgó y nunca cerró su estado — ya sabemos que en realidad terminó, no cuenta.
    if (since && (!lastReport || lastReport < since)) {
      out[agent.id] = "working";
      continue;
    }

    if (agent.id === "price-reader") {
      out[agent.id] = lastReport && lastReport >= recentCutoff ? "working" : "live";
      continue;
    }

    // Martín (price-analyst) y el resto: una vez que dejaron su informe de hoy, terminaron —
    // aunque el agente siga "escuchando" la próxima lista que le pase Lucas, no sigue "trabajando".
    const done = agent.id === "designer" ? bannerToday : !!lastReport;
    const [from, to] = TIER_WINDOW[agent.tier];
    out[agent.id] = done ? "done" : hour >= from && hour < to ? "working" : "live";
  }
  return out;
}
