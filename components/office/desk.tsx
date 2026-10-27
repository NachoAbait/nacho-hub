"use client";

import { useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { AgentDef, AgentStatus } from "@/lib/agents";
import { Character } from "@/components/office/character";
import { screenTexture, woodTexture } from "@/lib/office/textures";

const STATUS_DOT: Record<AgentStatus, string> = {
  live: "#22c55e",
  done: "#f59e0b",
  idle: "#6b7280",
};

interface Props {
  agent: AgentDef;
  status: AgentStatus;
  position: [number, number];
  deskColor: string;
  accent: string;
  selected: boolean;
  seed: number;
  /** El piso está visible: si no, la etiqueta HTML se oculta (drei no la oculta sola). */
  visible: boolean;
  onSelect: (id: string) => void;
}

/** Escritorio + monitor + silla + agente. El muñeco mira a +z (hacia la cámara). */
export function Desk({ agent, status, position, deskColor, accent, selected, seed, visible, onSelect }: Props) {
  const [hover, setHover] = useState(false);
  const [x, z] = position;
  const energy = status === "idle" ? 0.15 : status === "done" ? 0.6 : 1;

  const wood = useMemo(() => woodTexture(deskColor, [1.5, 0.8], 11), [deskColor]);
  const screen = useMemo(() => screenTexture(accent, Math.round(seed * 10)), [accent, seed]);

  function click(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    onSelect(agent.id);
  }

  return (
    <group
      position={[x, 0, z]}
      onClick={click}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = "auto"; }}
    >
      {/* tapa */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.06, 0.85]} />
        <meshStandardMaterial map={wood} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* patas */}
      {[[-0.78, -0.35], [0.78, -0.35], [-0.78, 0.35], [0.78, 0.35]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.36, lz]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.72, 10]} />
          <meshStandardMaterial color="#3a3a3f" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      {/* monitor: pantalla mira al agente (-z) */}
      <mesh position={[0, 0.79, 0.2]}>
        <cylinderGeometry args={[0.12, 0.17, 0.03, 16]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.9, 0.2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.2, 10]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 1.1, 0.2]} castShadow>
        <boxGeometry args={[0.74, 0.46, 0.035]} />
        <meshStandardMaterial color="#1a1a1d" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, 1.1, 0.18]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.68, 0.4]} />
        <meshStandardMaterial map={screen} emissiveMap={screen} emissive="#ffffff" emissiveIntensity={energy > 0.3 ? 1.6 : 0.35} toneMapped={false} roughness={0.2} />
      </mesh>
      {/* teclado y mouse */}
      <mesh position={[0, 0.78, -0.15]}>
        <boxGeometry args={[0.46, 0.02, 0.15]} />
        <meshStandardMaterial color="#2b2b30" roughness={0.6} />
      </mesh>
      <mesh position={[0.4, 0.78, -0.12]}>
        <capsuleGeometry args={[0.03, 0.04, 4, 8]} />
        <meshStandardMaterial color="#2b2b30" roughness={0.6} />
      </mesh>
      {/* taza */}
      <mesh position={[-0.6, 0.81, 0.05]}>
        <cylinderGeometry args={[0.045, 0.04, 0.09, 12]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.5} />
      </mesh>
      {/* silla */}
      <group position={[0, 0, -0.95]}>
        <mesh position={[0, 0.44, 0]} castShadow>
          <boxGeometry args={[0.52, 0.07, 0.5]} />
          <meshStandardMaterial color="#232327" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.8, -0.22]} rotation={[-0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.5, 0.66, 0.07]} />
          <meshStandardMaterial color="#232327" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 10]} />
          <meshStandardMaterial color="#3a3a3f" roughness={0.4} metalness={0.7} />
        </mesh>
        {[0, 1.26, 2.51, 3.77, 5.03].map((r) => (
          <mesh key={r} position={[Math.cos(r) * 0.16, 0.03, Math.sin(r) * 0.16]} rotation={[0, -r, 0]}>
            <boxGeometry args={[0.3, 0.03, 0.04]} />
            <meshStandardMaterial color="#3a3a3f" roughness={0.4} metalness={0.7} />
          </mesh>
        ))}
      </group>
      {/* agente */}
      <group position={[0, 0, -0.8]}>
        <Character tier={agent.tier} energy={energy} seed={seed} />
      </group>
      {/* halo de selección */}
      {(selected || hover) && (
        <mesh position={[0, 0.02, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.25, 1.4, 48]} />
          <meshBasicMaterial color={selected ? accent : "#ffffff"} transparent opacity={selected ? 0.9 : 0.4} />
        </mesh>
      )}
      {/* etiqueta flotante */}
      <Html position={[0, 1.85, -0.8]} center distanceFactor={14} zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ visibility: visible ? "visible" : "hidden" }} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-black/80 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_DOT[status], boxShadow: `0 0 6px ${STATUS_DOT[status]}` }} />
          {agent.name}
        </div>
      </Html>
    </group>
  );
}
