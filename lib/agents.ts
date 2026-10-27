import type { BusinessContext } from "@/lib/types";

export type Tier = "readers" | "analysts" | "creators" | "chief";

export interface TierInfo {
  id: Tier;
  label: string;
  tagline: string;
}

export const TIERS: TierInfo[] = [
  { id: "readers", label: "Readers", tagline: "Recolectan datos crudos" },
  { id: "analysts", label: "Analysts", tagline: "Interpretan los datos" },
  { id: "creators", label: "Creators", tagline: "Producen output" },
  { id: "chief", label: "Chief of Staff", tagline: "Arma el Daily Brief" },
];

export interface AgentDef {
  id: string;
  name: string;
  /** Nombre de persona ficticio que se muestra sobre el escritorio. */
  persona: string;
  tier: Tier;
  /** En qué pisos tiene escritorio. */
  contexts: BusinessContext[];
  description: string;
  /** Fase en la que se construye (1-5), según CLAUDE.md. */
  phase: number;
  /** true cuando el agente ya está programado y corre. */
  live: boolean;
}

/** Los 13 agentes de CLAUDE.md. El orden define la posición del escritorio dentro del sector. */
export const AGENTS: AgentDef[] = [
  // TIER 1 — READERS
  { id: "price-reader", persona: "Lucas", name: "Price Reader", tier: "readers", contexts: ["BNB"], phase: 2, live: false,
    description: "Lee WhatsApp de proveedores Apple/Samsung, extrae modelo, capacidad y precio USD, actualiza products." },
  { id: "competitor-scraper", persona: "Sofía", name: "Competitor Scraper", tier: "readers", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "Scrapea Instagram de la competencia y guarda posts, precios y promos." },
  { id: "market-watcher", persona: "Tomás", name: "Market Watcher", tier: "readers", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "Noticias Apple y dólar MEP para BNB; SENASA y mercado de hacienda para AgroScan." },
  { id: "social-collector", persona: "Valentina", name: "Social Collector", tier: "readers", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "Métricas de las cuentas propias de Instagram vía Graph API." },

  // TIER 2 — ANALYSTS
  { id: "price-analyst", persona: "Martín", name: "Price Analyst", tier: "analysts", contexts: ["BNB"], phase: 3, live: false,
    description: "Compara precios propios contra la competencia." },
  { id: "content-analyst", persona: "Camila", name: "Content Analyst", tier: "analysts", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "Qué posts rinden y por qué." },
  { id: "ads-analyst", persona: "Joaquín", name: "Ads Analyst", tier: "analysts", contexts: ["BNB"], phase: 3, live: false,
    description: "Performance de Meta Ads, detecta anomalías." },
  { id: "stock-analyst", persona: "Julieta", name: "Stock Analyst", tier: "analysts", contexts: ["BNB"], phase: 3, live: false,
    description: "Rotación, márgenes y cash flow." },

  // TIER 3 — CREATORS
  { id: "designer", persona: "Nico", name: "Designer", tier: "creators", contexts: ["BNB"], phase: 1, live: true,
    description: "Banners automáticos con HTML + Playwright. Pipeline validado y en producción." },
  { id: "content-creator", persona: "Agustina", name: "Content Creator", tier: "creators", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "3 ideas diarias de posts, reels y stories." },
  { id: "copy-writer", persona: "Facundo", name: "Copy Writer", tier: "creators", contexts: ["BNB", "AgroScan"], phase: 3, live: false,
    description: "Captions, descripciones y respuestas a DMs frecuentes." },
  { id: "dm-handler", persona: "Micaela", name: "DM Handler", tier: "creators", contexts: ["BNB"], phase: 3, live: false,
    description: "Responde DMs rutinarios. Bonus de Fase 3." },

  // TIER 4 — CHIEF
  { id: "chief-of-staff", persona: "Ernesto", name: "Chief of Staff", tier: "chief", contexts: ["BNB", "AgroScan"], phase: 4, live: false,
    description: "Lee a los 11 anteriores y arma un Daily Brief con 3 acciones concretas." },
];

export function agentsFor(context: BusinessContext): AgentDef[] {
  return AGENTS.filter((a) => a.contexts.includes(context));
}

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/**
 * Estado visible en la oficina.
 * - working: está corriendo ahora mismo
 * - done: ya dejó su output de hoy
 * - live: operativo, esperando su turno
 * - idle: todavía no construido (duerme en el escritorio)
 */
export type AgentStatus = "working" | "done" | "live" | "idle";

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Trabajando",
  done: "Terminó por hoy",
  live: "En espera",
  idle: "Sin construir",
};

export const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "#22c55e",
  done: "#f59e0b",
  live: "#3b82f6",
  idle: "#6b7280",
};

/** Ventana horaria (hora ART) en la que corre cada tier según el flow diario de CLAUDE.md. */
export const TIER_WINDOW: Record<Tier, [number, number]> = {
  readers: [3, 5],
  analysts: [5, 6],
  creators: [6, 7],
  chief: [7, 7.5],
};
