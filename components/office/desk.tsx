"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { AgentDef, AgentStatus } from "@/lib/agents";
import { Character } from "@/components/office/character";

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
  selected: boolean;
  seed: number;
  /** El piso está visible: si no, no se renderiza la etiqueta HTML (drei no la oculta sola). */
  visible: boolean;
  onSelect: (id: string) => void;
}

/** Escritorio + monitor + silla + agente. El muñeco mira a +z (hacia la cámara). */
export function Desk({ agent, status, position, deskColor, selected, seed, visible, onSelect }: Props) {
  const [hover, setHover] = useState(false);
  const [x, z] = position;
  const energy = status === "idle" ? 0.15 : status === "done" ? 0.6 : 1;

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
        <boxGeometry args={[1.7, 0.08, 0.85]} />
        <meshStandardMaterial color={deskColor} roughness={0.6} />
      </mesh>
      {/* patas */}
      {[[-0.78, -0.35], [0.78, -0.35], [-0.78, 0.35], [0.78, 0.35]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.36, lz]}>
          <cylinderGeometry args={[0.03, 0.03, 0.72, 8]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
      ))}
      {/* monitor (pantalla mira al agente, en -z) */}
      <mesh position={[0, 0.8, 0.2]}>
        <cylinderGeometry args={[0.12, 0.16, 0.04, 12]} />
        <meshStandardMaterial color="#1c1c1c" />
      </mesh>
      <mesh position={[0, 1.08, 0.2]} castShadow>
        <boxGeometry args={[0.72, 0.44, 0.04]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.08, 0.177]}>
        <planeGeometry args={[0.66, 0.38]} />
        <meshStandardMaterial color="#9ec5ff" emissive="#6aa3ff" emissiveIntensity={energy > 0.3 ? 1.2 : 0.2} />
      </mesh>
      {/* teclado */}
      <mesh position={[0, 0.79, -0.15]}>
        <boxGeometry args={[0.5, 0.02, 0.16]} />
        <meshStandardMaterial color="#2f2f2f" />
      </mesh>
      {/* silla */}
      <mesh position={[0, 0.42, -0.95]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.5]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[0, 0.78, -1.17]} castShadow>
        <boxGeometry args={[0.5, 0.65, 0.08]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      {/* agente */}
      <group position={[0, 0, -0.8]}>
        <Character tier={agent.tier} energy={energy} seed={seed} />
      </group>
      {/* halo de selección */}
      {(selected || hover) && (
        <mesh position={[0, 0.02, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.25, 1.4, 48]} />
          <meshBasicMaterial color={selected ? "#e2b94d" : "#ffffff"} transparent opacity={selected ? 0.9 : 0.4} />
        </mesh>
      )}
      {/* etiqueta flotante */}
      <Html position={[0, 1.75, -0.8]} center distanceFactor={14} zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ visibility: visible ? "visible" : "hidden" }} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-black/80 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_DOT[status], boxShadow: `0 0 6px ${STATUS_DOT[status]}` }} />
          {agent.name}
        </div>
      </Html>
    </group>
  );
}
