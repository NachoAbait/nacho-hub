import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import type { BusinessContext } from "@/lib/types";
import { estimateCostUsd, type ClaudeUsage } from "@/lib/claude";

/** Lo que recibe cada agente al correr. */
export interface AgentContext {
  db: SupabaseClient;
  context: BusinessContext;
  /** Fecha de hoy en Argentina, YYYY-MM-DD. */
  today: string;
  runId: string;
  trigger: RunTrigger;
  /** Acumula el uso de Claude para calcular el costo de la corrida. */
  usage: ClaudeUsage[];
  log: (msg: string) => void;
}

export type RunTrigger = "manual" | "cron" | "ingest";

/** Lo que devuelve cada agente. */
export interface AgentResult {
  /** Informe en markdown, en voseo, para leer en el panel. */
  markdown: string;
  /** Una línea para la etiqueta y el Chief. */
  summary: string;
  /** Datos estructurados para que otros agentes los consuman. */
  data?: unknown;
}

export interface AgentModule {
  id: string;
  /** En qué negocios corre. */
  contexts: BusinessContext[];
  /** Variables de entorno que necesita para funcionar del todo. */
  requiredEnv?: string[];
  run: (ctx: AgentContext) => Promise<AgentResult>;
}

export function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

export interface RunOutcome {
  ok: boolean;
  runId: string;
  agentId: string;
  context: BusinessContext;
  summary?: string;
  error?: string;
  costUsd: number;
  ms: number;
}

/** Variables de entorno que le faltan a un agente. */
export function missingEnv(mod: AgentModule): string[] {
  return (mod.requiredEnv ?? []).filter((k) => !process.env[k]);
}

/**
 * Corre un agente de punta a punta: registra la corrida, ejecuta, guarda el informe
 * y cierra la corrida con costo y estado. Nunca tira: devuelve el error en el resultado.
 */
export async function runAgent(mod: AgentModule, context: BusinessContext, trigger: RunTrigger): Promise<RunOutcome> {
  const db = supabaseAdmin();
  const t0 = Date.now();
  const today = todayArt();

  const { data: run, error: runErr } = await db
    .from("agent_runs")
    .insert({ agent_id: mod.id, context, trigger })
    .select("id")
    .single<{ id: string }>();
  if (runErr || !run) {
    return { ok: false, runId: "", agentId: mod.id, context, error: `No pude registrar la corrida: ${runErr?.message}`, costUsd: 0, ms: 0 };
  }

  const usage: ClaudeUsage[] = [];
  const ctx: AgentContext = {
    db,
    context,
    today,
    runId: run.id,
    trigger,
    usage,
    log: (msg) => console.log(`[${mod.id}/${context}] ${msg}`),
  };

  try {
    const missing = missingEnv(mod);
    if (missing.length) ctx.log(`faltan variables: ${missing.join(", ")} (corre en modo limitado)`);

    const result = await mod.run(ctx);
    const costUsd = estimateCostUsd(usage);

    await db.from("agent_reports").insert({
      agent_name: mod.id,
      context,
      date: today,
      content_markdown: result.markdown,
      raw_data_json: result.data ?? null,
      run_id: run.id,
      summary: result.summary,
    });
    await db
      .from("agent_runs")
      .update({ status: "ok", finished_at: new Date().toISOString(), summary: result.summary, cost_usd: costUsd, usage_json: usage })
      .eq("id", run.id);

    ctx.log(`ok · ${result.summary} · US$ ${costUsd.toFixed(4)} · ${Date.now() - t0} ms`);
    return { ok: true, runId: run.id, agentId: mod.id, context, summary: result.summary, costUsd, ms: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const costUsd = estimateCostUsd(usage);
    await db
      .from("agent_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: message, cost_usd: costUsd, usage_json: usage })
      .eq("id", run.id);
    ctx.log(`ERROR · ${message}`);
    return { ok: false, runId: run.id, agentId: mod.id, context, error: message, costUsd, ms: Date.now() - t0 };
  }
}

/** Último informe de un agente para un contexto (hoy o el más reciente). */
export async function latestReport(db: SupabaseClient, agentId: string, context?: BusinessContext) {
  let q = db
    .from("agent_reports")
    .select("id, agent_name, context, date, content_markdown, raw_data_json, summary, created_at")
    .eq("agent_name", agentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (context) q = q.eq("context", context);
  const { data } = await q.maybeSingle();
  return data;
}

/** Informes de hoy de varios agentes, para que los analistas y el Chief los lean. */
export async function reportsToday(db: SupabaseClient, agentIds: string[], context: BusinessContext, today: string) {
  const { data } = await db
    .from("agent_reports")
    .select("agent_name, context, content_markdown, raw_data_json, summary, created_at")
    .in("agent_name", agentIds)
    .in("context", [context, "AMBOS"])
    .eq("date", today)
    .order("created_at", { ascending: false });
  // Nos quedamos con el más reciente de cada agente
  const seen = new Map<string, NonNullable<typeof data>[number]>();
  for (const r of data ?? []) if (!seen.has(r.agent_name)) seen.set(r.agent_name, r);
  return [...seen.values()];
}

/** Lee una clave de hub_settings con un valor por defecto. */
export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("hub_settings").select("value").eq("key", key).maybeSingle<{ value: T }>();
  return (data?.value as T) ?? fallback;
}
