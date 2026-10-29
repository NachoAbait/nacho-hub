import type { AgentModule } from "@/lib/agents/runtime";
import { AGENTS, type Tier } from "@/lib/agents";
import { designer } from "@/lib/agents/designer";
import { priceReader } from "@/lib/agents/price-reader";
import { priceAnalyst } from "@/lib/agents/price-analyst";
import { stockAnalyst } from "@/lib/agents/stock-analyst";
import { marketWatcher } from "@/lib/agents/market-watcher";
import { competitorScraper } from "@/lib/agents/competitor-scraper";
import { contentCreator } from "@/lib/agents/content-creator";
import { copyWriter } from "@/lib/agents/copy-writer";
import { chiefOfStaff } from "@/lib/agents/chief-of-staff";
import { globalAnalyst } from "@/lib/agents/global-analyst";
import { dmHandler } from "@/lib/agents/dm-handler";

/**
 * Agentes con módulo programado. Los otros 3 de lib/agents.ts (Social Collector, Ads Analyst,
 * Content Analyst) necesitan un token de Meta/Instagram Graph API que todavía no tenemos: sus
 * playbooks ya están listos en lib/agents/skills, falta solo la credencial para darles módulo.
 */
const MODULES: AgentModule[] = [
  priceReader,
  priceAnalyst,
  stockAnalyst,
  marketWatcher,
  competitorScraper,
  designer,
  contentCreator,
  copyWriter,
  dmHandler,
  chiefOfStaff,
  globalAnalyst,
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
