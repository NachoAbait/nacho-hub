import type { AgentModule } from "@/lib/agents/runtime";
import { AGENTS, type Tier } from "@/lib/agents";
import { designer } from "@/lib/agents/designer";
import { priceReader } from "@/lib/agents/price-reader";
import { priceAnalyst } from "@/lib/agents/price-analyst";
import { priceHistorian } from "@/lib/agents/price-historian";
import { catalogManager } from "@/lib/agents/catalog-manager";
import { stockAnalyst } from "@/lib/agents/stock-analyst";
import { marketWatcher } from "@/lib/agents/market-watcher";
import { competitorScraper } from "@/lib/agents/competitor-scraper";
import { reelScout } from "@/lib/agents/reel-scout";
import { contentCreator } from "@/lib/agents/content-creator";
import { copyWriter } from "@/lib/agents/copy-writer";
import { chiefOfStaff } from "@/lib/agents/chief-of-staff";
import { globalAnalyst } from "@/lib/agents/global-analyst";
import { dmHandler } from "@/lib/agents/dm-handler";
import { videoEditor } from "@/lib/agents/video-editor";

/**
 * Agentes con módulo programado. Los otros 3 de lib/agents.ts (Social Collector, Ads Analyst,
 * Content Analyst) necesitan un token de Meta/Instagram Graph API que todavía no tenemos: sus
 * playbooks ya están listos en lib/agents/skills, falta solo la credencial para darles módulo.
 */
const MODULES: AgentModule[] = [
  priceReader,
  priceAnalyst,
  priceHistorian,
  catalogManager,
  stockAnalyst,
  marketWatcher,
  competitorScraper,
  reelScout,
  designer,
  contentCreator,
  copyWriter,
  dmHandler,
  videoEditor,
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
  // Designer corre en su propio horario (ver vercel.json: /api/agents/designer una vez al día), no
  // en el cron diario de Creators. Video Editor NO tiene cron en Vercel (el render de Remotion no
  // corre ahí, ver lib/video-editor/render.ts): lo dispara el puente local bridge/video-editor/,
  // así que tampoco entra en el cron de Creators.
  return MODULES.filter((m) => tierOf(m.id) === tier && m.id !== "designer" && m.id !== "video-editor");
}
