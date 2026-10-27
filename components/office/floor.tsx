"use client";

import { Html } from "@react-three/drei";
import type { AgentStatus } from "@/lib/agents";
import { TIERS } from "@/lib/agents";
import { FLOOR_D, FLOOR_W, WALL_H, floorLayout, type FloorTheme } from "@/lib/office/layout";
import { Desk } from "@/components/office/desk";

interface Props {
  theme: FloorTheme;
  statuses: Record<string, AgentStatus>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  visible: boolean;
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.5, 10]} />
        <meshStandardMaterial color="#8a5a3c" />
      </mesh>
      {[0, 1.2, 2.4, 3.6, 4.8].map((r, i) => (
        <mesh key={i} position={[Math.cos(r) * 0.12, 0.85, Math.sin(r) * 0.12]} rotation={[Math.cos(r) * 0.4, 0, Math.sin(r) * 0.4]} castShadow>
          <coneGeometry args={[0.14, 0.75, 6]} />
          <meshStandardMaterial color={i % 2 ? "#3f9a4f" : "#2f7d3f"} />
        </mesh>
      ))}
    </group>
  );
}

function Window({ x, accent }: { x: number; accent: string }) {
  return (
    <group position={[x, 2.5, -FLOOR_D / 2 + 0.12]}>
      <mesh>
        <boxGeometry args={[5.2, 2.6, 0.08]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <planeGeometry args={[4.9, 2.3]} />
        <meshStandardMaterial color="#0d1830" emissive="#1a2b55" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export function Floor({ theme, statuses, selectedId, onSelect, visible }: Props) {
  const layout = floorLayout(theme.id);
  const total = layout.reduce((n, s) => n + s.desks.length, 0);

  return (
    <group position={[0, theme.y, 0]} visible={visible}>
      {/* losa */}
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[FLOOR_W, 0.4, FLOOR_D]} />
        <meshStandardMaterial color={theme.floor} roughness={0.9} />
      </mesh>
      {/* pared de fondo y lateral izquierda */}
      <mesh position={[0, WALL_H / 2, -FLOOR_D / 2]} receiveShadow>
        <boxGeometry args={[FLOOR_W, WALL_H, 0.2]} />
        <meshStandardMaterial color={theme.wall} roughness={0.95} />
      </mesh>
      <mesh position={[-FLOOR_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.2, WALL_H, FLOOR_D]} />
        <meshStandardMaterial color={theme.wall} roughness={0.95} />
      </mesh>
      <Window x={-9} accent={theme.accent} />
      <Window x={9} accent={theme.accent} />

      {/* sectores */}
      {layout.map(({ sector, desks }) => {
        const [cx, cz] = sector.center;
        const [w, d] = sector.size;
        const tier = TIERS.find((t) => t.id === sector.tier)!;
        return (
          <group key={sector.tier}>
            <mesh position={[cx, 0.012, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[w, d]} />
              <meshStandardMaterial color={theme.rugs[sector.tier]} roughness={1} />
            </mesh>
            <Html transform position={[cx, 2.3, cz - d / 2 + 0.2]} distanceFactor={6} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="rounded-lg border-l-4 bg-black/90 px-4 py-2 shadow-xl" style={{ visibility: visible ? "visible" : "hidden", borderColor: theme.accent }}>
                <div className="text-lg font-black uppercase leading-none tracking-tight text-white">Equipo {tier.label}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">
                  {tier.tagline} · {desks.length} {desks.length === 1 ? "agente" : "agentes"}
                </div>
              </div>
            </Html>
            {desks.map(({ agent, position }, i) => (
              <Desk
                key={agent.id}
                agent={agent}
                status={statuses[agent.id] ?? "idle"}
                position={position}
                deskColor={theme.desk}
                selected={selectedId === agent.id}
                seed={i * 1.7 + cx}
                visible={visible}
                onSelect={onSelect}
              />
            ))}
          </group>
        );
      })}

      {/* cartel de marca en la pared de fondo */}
      <Html transform position={[0, 3.2, -FLOOR_D / 2 + 0.2]} distanceFactor={7} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="flex items-center gap-4 rounded-xl border px-6 py-3 shadow-2xl" style={{ visibility: visible ? "visible" : "hidden", background: "#0b0b0d", borderColor: theme.accent }}>
          <div className="grid h-14 w-14 place-items-center rounded-lg text-3xl font-black" style={{ background: theme.accent, color: "#0b0b0d" }}>
            {theme.id === "BNB" ? "B" : "A"}
          </div>
          <div>
            <div className="text-3xl font-black uppercase leading-none tracking-tight text-white">{theme.name}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: theme.accent }}>
              {theme.subtitle} · {total} agentes
            </div>
          </div>
        </div>
      </Html>

      <Plant position={[-12, 0, -7]} />
      <Plant position={[0.3, 0, -7]} />
      <Plant position={[-12, 0, 7]} />
      <Plant position={[12, 0, 0.5]} />
    </group>
  );
}
