import type { AgentModule } from "@/lib/agents/runtime";
import { AGENTS, type Tier } from "@/lib/agents";
import { designer } from "@/lib/agents/designer";
import { priceReader } from "@/lib/agents/price-reader";
import { priceAnalyst } from "@/lib/agents/price-analyst";

/**
 * Agentes con módulo programado. Los otros 10 de lib/agents.ts se suman acá cuando existan
 * (basta con importar el módulo y agregarlo a la lista; el cron y /api/agents/[id] lo toman solos).
 */
const MODULES: AgentModule[] = [priceReader, priceAnalyst, designer];

export const REGISTRY: Record<string, AgentModule> = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export function getAgentModule(id: string): AgentModule | undefined {
  return REGISTRY[id];
}

export function tierOf(id: string): Tier | undefined {
  return AGENTS.find((a) => a.id === id)?.tier;
}

export function modulesOfTier(tier: Tier): AgentModule[] {
  return MODULES.filter((m) => tierOf(m.id) === tier);
}
