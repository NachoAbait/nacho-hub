import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

/**
 * Único punto de entrada a Claude en todo el hub (convención de CLAUDE.md).
 * - Reintentos: los maneja el SDK (maxRetries).
 * - Logs: cada llamada deja una línea con agente, modelo, tokens y duración.
 * - Modelos: Sonnet para análisis y redacción, Haiku para parsers (decisión de CLAUDE.md).
 */

export const MODELS = {
  /** Parsers y extracción estructurada: barato y rápido. */
  parser: "claude-haiku-5-5",
  /** Análisis, informes y redacción. */
  analyst: "claude-sonnet-5-5",
} as const;

export type ModelRole = keyof typeof MODELS;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY: cargala en .env.local y en Vercel para que los agentes puedan pensar.");
  }
  if (!client) client = new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return client;
}

export interface ClaudeUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  ms: number;
}

export interface AskOptions {
  /** Nombre del agente, solo para logs. */
  agent: string;
  role?: ModelRole;
  /** System prompt estable (playbook del agente). Se cachea. */
  system: string;
  /** Contenido variable del día. */
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Acumulador opcional de uso, para guardarlo en agent_runs. */
  usage?: ClaudeUsage[];
}

function log(agent: string, usage: ClaudeUsage) {
  console.log(
    `[claude] ${agent} ${usage.model} in=${usage.input_tokens} cached=${usage.cache_read_input_tokens} out=${usage.output_tokens} ${usage.ms}ms`,
  );
}

/** Texto libre (markdown). */
export async function askText(opts: AskOptions): Promise<string> {
  const c = getClient();
  const t0 = Date.now();
  const res = await c.messages.create({
    model: MODELS[opts.role ?? "analyst"],
    max_tokens: opts.maxTokens ?? 4000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "medium" },
  });
  const usage: ClaudeUsage = {
    model: res.model,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
    ms: Date.now() - t0,
  };
  log(opts.agent, usage);
  opts.usage?.push(usage);
  if (res.stop_reason === "refusal") throw new Error(`Claude rechazó la tarea de ${opts.agent}`);
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Salida estructurada validada con un esquema Zod. */
export async function askJson<T>(opts: AskOptions & { schema: ZodType<T> }): Promise<T> {
  const c = getClient();
  const t0 = Date.now();
  const res = await c.messages.parse({
    model: MODELS[opts.role ?? "parser"],
    max_tokens: opts.maxTokens ?? 4000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "low", format: zodOutputFormat(opts.schema) },
  });
  const usage: ClaudeUsage = {
    model: res.model,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
    ms: Date.now() - t0,
  };
  log(opts.agent, usage);
  opts.usage?.push(usage);
  if (res.stop_reason === "refusal") throw new Error(`Claude rechazó la tarea de ${opts.agent}`);
  if (!res.parsed_output) throw new Error(`Claude no devolvió JSON válido para ${opts.agent}`);
  return res.parsed_output;
}

/**
 * Texto con búsqueda web del lado del servidor de Anthropic (Sonnet).
 * Sirve para los agentes que necesitan datos públicos actuales sin scrapear nada.
 * `maxSearches` acota el costo (cada búsqueda vale aparte de los tokens).
 */
export async function askWithWeb(opts: AskOptions & { maxSearches?: number }): Promise<string> {
  const c = getClient();
  const t0 = Date.now();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  let text = "";
  // Con herramientas de servidor el turno puede pausarse (pause_turn): se reanuda hasta 3 veces.
  for (let i = 0; i < 3; i++) {
    const res = await c.messages.create({
      model: MODELS.analyst,
      max_tokens: opts.maxTokens ?? 6000,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 5 }],
      output_config: { effort: opts.effort ?? "medium" },
    });
    const usage: ClaudeUsage = {
      model: res.model,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
      ms: Date.now() - t0,
    };
    log(opts.agent, usage);
    opts.usage?.push(usage);
    if (res.stop_reason === "refusal") throw new Error(`Claude rechazó la tarea de ${opts.agent}`);
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return text;
}

/** Costo aproximado en USD de una lista de usos (precios de lista, octubre 2026). */
export function estimateCostUsd(usages: ClaudeUsage[]): number {
  const price: Record<string, [number, number]> = {
    "claude-haiku-5-5": [0.1, 0.5],
    "claude-sonnet-5-5": [2, 10],
  };
  let usd = 0;
  for (const u of usages) {
    const [pin, pout] = price[u.model] ?? [2, 10];
    usd += (u.input_tokens / 1e6) * pin + (u.output_tokens / 1e6) * pout;
  }
  return usd;
}
