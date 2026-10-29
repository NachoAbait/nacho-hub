import type { AgentModule } from "@/lib/agents/runtime";
import { AGENTS, type Tier } from "@/lib/agents";
import { designer } from "@/lib/agents/designer";
import { priceReader } from "@/lib/agents/price-reader";
import { priceAnalyst } from "@/lib/agents/price-analyst";
import { stockAnalyst } from "@/lib/agents/stock-analyst";
import { marketWatcher } from "@/lib/agents/market-watcher";
import { competitorScraper } from "@/lib/agents/competitor-scraper";
import { chiefOfStaff } from "@/lib/agents/chief-of-staff";

/**
 * Agentes con módulo programado. Los otros 6 de lib/agents.ts se suman acá cuando existan
 * (basta con importar el módulo y agregarlo a la lista; el cron y /api/agents/[id] lo toman solos).
 */
const MODULES: AgentModule[] = [
  priceReader,
  priceAnalyst,
  stockAnalyst,
  marketWatcher,
  competitorScraper,
  chiefOfStaff,
  designer,
];

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
