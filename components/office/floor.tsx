"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Material, Mesh } from "three";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { AgentStatus, Tier } from "@/lib/agents";
import { TIERS } from "@/lib/agents";
import { FLOOR_D, FLOOR_W, WALL_H, floorLayout, type FloorTheme } from "@/lib/office/layout";
import { cityTexture, woodTexture } from "@/lib/office/textures";
import { Desk } from "@/components/office/desk";

interface Props {
  theme: FloorTheme;
  statuses: Record<string, AgentStatus>;
  selectedId: string | null;
  focusedTier: Tier | null;
  onSelect: (id: string) => void;
  onFocusSector: (tier: Tier | null) => void;
  visible: boolean;
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.18, 0.5, 14]} />
        <meshStandardMaterial color="#9a6a48" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.03, 14]} />
        <meshStandardMaterial color="#3b2a1c" roughness={1} />
      </mesh>
      {[0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4].map((r, i) => (
        <mesh key={i} position={[Math.cos(r) * 0.14, 0.9 + (i % 2) * 0.12, Math.sin(r) * 0.14]} rotation={[Math.cos(r) * 0.5, 0, Math.sin(r) * 0.5]} castShadow>
          <coneGeometry args={[0.13, 0.85, 5]} />
          <meshStandardMaterial color={i % 2 ? "#3f9a4f" : "#2f7d3f"} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Window({ x, accent, city }: { x: number; accent: string; city: ReturnType<typeof cityTexture> }) {
  return (
    <group position={[x, 2.5, -FLOOR_D / 2 + 0.12]}>
      <mesh castShadow>
        <boxGeometry args={[5.4, 2.8, 0.1]} />
        <meshStandardMaterial color={accent} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[5.05, 2.45]} />
        <meshStandardMaterial map={city} emissiveMap={city} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.1} metalness={0.1} />
      </mesh>
      {/* parantes */}
      <mesh position={[0, 0, 0.07]}>
        <boxGeometry args={[0.06, 2.45, 0.02]} />
        <meshStandardMaterial color={accent} />
      </mesh>
    </group>
  );
}

function Lamp({ position, accent }: { position: [number, number, number]; accent: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.2, 6]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh castShadow>
        <coneGeometry args={[0.42, 0.32, 24, 1, true]} />
        <meshStandardMaterial color={accent} roughness={0.35} metalness={0.6} side={2} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.02, 24]} />
        <meshStandardMaterial color="#fff3d6" emissive="#ffd9a0" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, -0.3, 0]} intensity={14} distance={9} decay={2} color={accent === "#e2b94d" ? "#ffe2b0" : "#fff6e6"} />
    </group>
  );
}

function applyOpacity(list: Material[], value: number) {
  for (const m of list) {
    m.opacity = value;
    m.transparent = value < 1;
  }
}

export function Floor({ theme, statuses, selectedId, focusedTier, onSelect, onFocusSector, visible }: Props) {
  const layout = floorLayout(theme.id);
  const group = useRef<Group>(null);
  const materials = useRef<Material[]>([]);
  const opacity = useRef(visible ? 1 : 0);
  // Las etiquetas HTML se muestran cuando el piso pasa de media opacidad.
  const [labelsShown, setLabelsShown] = useState(visible);

  // Junta todos los materiales del piso una vez montado, para poder desvanecerlos.
  useEffect(() => {
    const list: Material[] = [];
    group.current?.traverse((o) => {
      const m = (o as Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) if (!list.includes(mat)) list.push(mat);
    });
    materials.current = list;
    // Estado inicial: el piso oculto arranca invisible, sin esperar al primer frame.
    if (group.current) {
      group.current.visible = opacity.current > 0;
      applyOpacity(list, opacity.current);
    }
  });

  useFrame((_, rawDelta) => {
    const g = group.current;
    if (!g) return;
    const delta = Math.min(rawDelta, 0.1); // en máquinas lentas no saltar el fundido
    const target = visible ? 1 : 0;
    const prev = opacity.current;
    if (Math.abs(prev - target) < 0.002) {
      if (prev !== target) {
        opacity.current = target;
        applyOpacity(materials.current, target);
        g.visible = target > 0;
        if (labelsShown !== visible) setLabelsShown(visible);
      }
      return;
    }
    const next = prev + (target - prev) * (1 - Math.exp(-delta * (visible ? 9 : 24)));
    opacity.current = next;
    g.visible = true;
    applyOpacity(materials.current, next);
    const shown = next > 0.5;
    if (shown !== labelsShown) setLabelsShown(shown);
  });
  const total = layout.reduce((n, s) => n + s.desks.length, 0);
  const wood = useMemo(
    () => woodTexture(theme.floor, [7, 4.5], theme.id === "BNB" ? 2 : theme.id === "AgroScan" ? 5 : 8),
    [theme.floor, theme.id],
  );
  const city = useMemo(() => cityTexture(theme.id === "BNB" ? 7 : theme.id === "AgroScan" ? 9 : 11), [theme.id]);

  function clearFocus(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    onFocusSector(null);
  }

  return (
    <group ref={group} position={[0, theme.y, 0]}>
      {/* losa + parquet */}
      <mesh position={[0, -0.2, 0]} receiveShadow onClick={clearFocus}>
        <boxGeometry args={[FLOOR_W, 0.4, FLOOR_D]} />
        <meshStandardMaterial color="#2a2118" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={clearFocus}>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial map={wood} roughness={0.45} metalness={0.05} />
      </mesh>
      {/* paredes */}
      <mesh position={[0, WALL_H / 2, -FLOOR_D / 2]} receiveShadow>
        <boxGeometry args={[FLOOR_W, WALL_H, 0.2]} />
        <meshStandardMaterial color={theme.wall} roughness={0.95} />
      </mesh>
      {[-FLOOR_W / 2, FLOOR_W / 2].map((x) => (
        <mesh key={x} position={[x, WALL_H / 2, 0]} receiveShadow>
          <boxGeometry args={[0.2, WALL_H, FLOOR_D]} />
          <meshStandardMaterial color={theme.wall} roughness={0.95} />
        </mesh>
      ))}
      {/* zócalos */}
      <mesh position={[0, 0.08, -FLOOR_D / 2 + 0.12]}>
        <boxGeometry args={[FLOOR_W, 0.16, 0.06]} />
        <meshStandardMaterial color="#111" roughness={0.6} />
      </mesh>
      {[-FLOOR_W / 2 + 0.12, FLOOR_W / 2 - 0.12].map((x) => (
        <mesh key={x} position={[x, 0.08, 0]}>
          <boxGeometry args={[0.06, 0.16, FLOOR_D]} />
          <meshStandardMaterial color="#111" roughness={0.6} />
        </mesh>
      ))}
      <Window x={-8.5} accent={theme.accent} city={city} />
      <Window x={8.5} accent={theme.accent} city={city} />

      {/* sectores */}
      {layout.map(({ sector, desks }) => {
        const [cx, cz] = sector.center;
        const [w, d] = sector.size;
        const tier = TIERS.find((t) => t.id === sector.tier)!;
        const focused = focusedTier === sector.tier;
        return (
          <group key={sector.tier}>
            <mesh
              position={[cx, 0.012, cz]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
              onClick={(e) => { e.stopPropagation(); onFocusSector(focused ? null : sector.tier); }}
              onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "zoom-in"; }}
              onPointerOut={() => { document.body.style.cursor = "auto"; }}
            >
              <planeGeometry args={[w, d]} />
              <meshStandardMaterial color={theme.rugs[sector.tier]} roughness={1} />
            </mesh>
            {focused && (
              <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[Math.min(w, d) / 2 - 0.1, Math.min(w, d) / 2 + 0.08, 64]} />
                <meshBasicMaterial color={theme.accent} transparent opacity={0.5} />
              </mesh>
            )}
            <Lamp position={[cx, 3.4, cz]} accent={theme.accent} />
            {/* Cartel al frente de la alfombra, bajo e inclinado hacia la cámara: no tapa los escritorios. */}
            <Html transform position={[cx, 1.25, cz + d / 2 - 0.4]} rotation={[-0.45, 0, 0]} distanceFactor={5} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div
                className={`rounded-lg border-l-4 px-4 py-2 shadow-xl transition ${focused ? "scale-110" : ""}`}
                style={{
                  visibility: labelsShown && (!focusedTier || focused) ? "visible" : "hidden",
                  borderColor: theme.accent,
                  background: focused ? theme.accent : "rgba(0,0,0,0.9)",
                  boxShadow: focused ? `0 0 30px ${theme.accent}` : undefined,
                }}
              >
                <div className={`text-lg font-black uppercase leading-none tracking-tight ${focused ? "text-black" : "text-white"}`}>Equipo {tier.label}</div>
                <div className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] ${focused ? "text-black/70" : "text-white/60"}`}>
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
                accent={theme.accent}
                selected={selectedId === agent.id}
                seed={i * 1.7 + cx}
                visible={labelsShown}
                labelMode={!focusedTier ? "normal" : focused ? "detail" : "hidden"}
                onSelect={onSelect}
              />
            ))}
          </group>
        );
      })}

      {/* cartel de marca en la pared de fondo */}
      <Html transform position={[0, 3.2, -FLOOR_D / 2 + 0.2]} distanceFactor={7} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="flex items-center gap-4 rounded-xl border px-6 py-3 shadow-2xl" style={{ visibility: labelsShown ? "visible" : "hidden", background: "#0b0b0d", borderColor: theme.accent }}>
          <div className="grid h-14 w-14 place-items-center rounded-lg text-3xl font-black" style={{ background: theme.accent, color: "#0b0b0d" }}>
            {theme.id === "BNB" ? "B" : theme.id === "AgroScan" ? "A" : "E"}
          </div>
          <div>
            <div className="text-3xl font-black uppercase leading-none tracking-tight text-white">{theme.name}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: theme.accent }}>
              {theme.subtitle} · {total} agentes
            </div>
          </div>
        </div>
      </Html>

      <Plant position={[-12, 0, -7]} scale={1.2} />
      <Plant position={[0.3, 0, -7]} />
      <Plant position={[-12, 0, 7]} />
      <Plant position={[12, 0, 0.5]} scale={1.1} />
    </group>
  );
}
