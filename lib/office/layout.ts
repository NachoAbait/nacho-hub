import type { BusinessContext } from "@/lib/types";
import { agentsFor, type AgentDef, type Tier } from "@/lib/agents";

/** Medidas del piso en unidades de escena (≈ metros). */
export const FLOOR_W = 26;
export const FLOOR_D = 16;
export const WALL_H = 4.6;
/** Distancia vertical entre planta baja y primer piso. */
export const FLOOR_GAP = 9;

export interface FloorTheme {
  id: BusinessContext;
  name: string;
  subtitle: string;
  y: number;
  floor: string;
  wall: string;
  accent: string;
  desk: string;
  rugs: Record<Tier, string>;
}

export const FLOORS: FloorTheme[] = [
  {
    id: "BNB",
    name: "BNB Store",
    subtitle: "Planta baja · Apple & Samsung · Dolores",
    y: 0,
    floor: "#5c3b24",
    wall: "#2c2c33",
    accent: "#e2b94d",
    desk: "#b8863f",
    rugs: { readers: "#1f2a44", analysts: "#2c1f44", creators: "#3b2a14", chief: "#3a1f1f" },
  },
  {
    id: "AgroScan",
    name: "AgroScan",
    subtitle: "Primer piso · Ganadería · Trazabilidad",
    y: FLOOR_GAP,
    floor: "#b9905c",
    wall: "#efe9da",
    accent: "#2f8f5b",
    desk: "#d7b485",
    rugs: { readers: "#9fd3b4", analysts: "#bcd9e8", creators: "#f0d9a3", chief: "#e3c4b0" },
  },
  {
    id: "GLOBAL",
    name: "Mundo",
    subtitle: "Segundo piso · Macro global · EE.UU. · Cripto · Geopolítica",
    y: FLOOR_GAP * 2,
    floor: "#1b2436",
    wall: "#0e1420",
    accent: "#4fd1c5",
    desk: "#2a3a52",
    rugs: { readers: "#1f3a4a", analysts: "#1f3a4a", creators: "#1f3a4a", chief: "#234a52" },
  },
];

export function floorTheme(id: BusinessContext): FloorTheme {
  return FLOORS.find((f) => f.id === id)!;
}

export interface SectorLayout {
  tier: Tier;
  center: [number, number];
  size: [number, number];
}

export const SECTORS: SectorLayout[] = [
  { tier: "readers", center: [-6.5, -3], size: [11, 7] },
  { tier: "analysts", center: [6.5, -3], size: [11, 7] },
  { tier: "creators", center: [-6.5, 4.5], size: [11, 6.5] },
  { tier: "chief", center: [6.5, 4.5], size: [8, 6.5] },
];

const DESK_DX = 3.4;
const DESK_DZ = 2.9;

/** Posiciones (x, z) de los escritorios de un sector, en grilla de 2 columnas centrada. */
export function deskPositions(sector: SectorLayout, count: number): [number, number][] {
  if (count === 0) return [];
  const cols = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / cols);
  const [cx, cz] = sector.center;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = cx + (col - (cols - 1) / 2) * DESK_DX;
    const z = cz + (row - (rows - 1) / 2) * DESK_DZ;
    out.push([x, z]);
  }
  return out;
}

export interface DeskPlacement {
  agent: AgentDef;
  position: [number, number];
}

export interface SectorPlacement {
  sector: SectorLayout;
  desks: DeskPlacement[];
}

/** Sectores y escritorios de un piso según los agentes que trabajan en ese negocio. */
export function floorLayout(context: BusinessContext): SectorPlacement[] {
  const agents = agentsFor(context);
  return SECTORS.map((sector) => {
    const inTier = agents.filter((a) => a.tier === sector.tier);
    const positions = deskPositions(sector, inTier.length);
    return { sector, desks: inTier.map((agent, i) => ({ agent, position: positions[i] })) };
  });
}
