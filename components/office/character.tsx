"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { AgentStatus, Tier } from "@/lib/agents";

const TIER_COLOR: Record<Tier, string> = {
  readers: "#2f6fe4",
  analysts: "#8b4fd6",
  creators: "#e0962a",
  chief: "#d2403a",
};

const SKINS = ["#f3cfae", "#e8b48c", "#c98f63", "#8d5a3b", "#f6dcc2"];
const HAIRS = ["#2b1b12", "#0f0f0f", "#5a3a22", "#9c6b3c", "#3a2a2a", "#d9b56a"];

interface Props {
  tier: Tier;
  status: AgentStatus;
  /** Desfase y variación de aspecto. */
  seed: number;
}

/** Pose objetivo por estado: inclinación del torso, cabeza y brazos (radianes). */
const POSE: Record<AgentStatus, { torso: number; head: number; arms: number; typing: number }> = {
  working: { torso: 0.14, head: 0.18, arms: -0.6, typing: 1 },     // inclinado al teclado, tipea rápido
  live: { torso: 0.02, head: 0.08, arms: -0.5, typing: 0.35 },      // erguido, tipea de a ratos
  done: { torso: -0.22, head: -0.08, arms: -0.15, typing: 0 },      // reclinado, brazos en la falda
  idle: { torso: 0.42, head: 0.75, arms: -0.95, typing: 0 },        // dormido sobre el escritorio
};

/** Muñeco low-poly sentado, mirando a +z. La animación depende del estado. */
export function Character({ tier, status, seed }: Props) {
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const head = useRef<Group>(null);
  const body = useRef<Group>(null);
  const torso = useRef<Mesh>(null);

  const look = useMemo(() => {
    const k = Math.abs(Math.floor(seed * 7.31));
    return { skin: SKINS[k % SKINS.length], hair: HAIRS[(k * 3) % HAIRS.length], hairStyle: k % 3 };
  }, [seed]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const pose = POSE[status];
    const k = 1 - Math.exp(-delta * 4); // suavizado hacia la pose objetivo

    // tipeo: en "live" va por ráfagas, en "working" es continuo
    const burst = status === "live" ? (Math.sin(t * 0.7 + seed) > 0.3 ? 1 : 0) : 1;
    const speed = status === "working" ? 11 : 6;
    const typing = t * speed + seed;
    const amp = 0.07 * pose.typing * burst;
    if (leftArm.current) leftArm.current.rotation.x += (pose.arms + Math.max(0, Math.sin(typing)) * amp - leftArm.current.rotation.x) * k;
    if (rightArm.current) rightArm.current.rotation.x += (pose.arms + Math.max(0, Math.sin(typing + Math.PI)) * amp - rightArm.current.rotation.x) * k;

    if (head.current) {
      const sway = status === "idle" ? 0.02 : 0.04;
      head.current.rotation.z += (Math.sin(t * 0.8 + seed) * sway - head.current.rotation.z) * k;
      const lookAround = status === "live" ? Math.sin(t * 0.35 + seed) * 0.35 : 0;
      head.current.rotation.y += (lookAround - head.current.rotation.y) * k;
      head.current.rotation.x += (pose.head + Math.sin(t * 0.5 + seed) * 0.03 - head.current.rotation.x) * k;
    }
    if (body.current) {
      body.current.rotation.x += (pose.torso - body.current.rotation.x) * k;
    }
    if (torso.current) {
      const breath = status === "idle" ? 0.02 : 0.012;
      torso.current.scale.y = 1 + Math.sin(t * (status === "idle" ? 0.9 : 1.6) + seed) * breath;
    }
  });

  const shirt = TIER_COLOR[tier];

  return (
    <group>
      {/* piernas (sentado): no se inclinan con el torso */}
      {[-0.11, 0.11].map((x) => (
        <group key={x} position={[x, 0.42, 0.12]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.32, 4, 8]} />
            <meshStandardMaterial color="#2a2f3a" roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.22, 0.26]} castShadow>
            <capsuleGeometry args={[0.065, 0.3, 4, 8]} />
            <meshStandardMaterial color="#2a2f3a" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* tronco entero pivota en la cadera */}
      <group ref={body} position={[0, 0.45, 0]}>
      {/* torso */}
      <mesh ref={torso} position={[0, 0.21, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.3, 6, 14]} />
        <meshStandardMaterial color={shirt} roughness={0.75} />
      </mesh>
      {/* hombros */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.37, 0]} castShadow>
          <sphereGeometry args={[0.085, 12, 12]} />
          <meshStandardMaterial color={shirt} roughness={0.75} />
        </mesh>
      ))}
      {/* cuello */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.1, 10]} />
        <meshStandardMaterial color={look.skin} roughness={0.8} />
      </mesh>
      {/* cabeza */}
      <group ref={head} position={[0, 0.68, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.18, 24, 24]} />
          <meshStandardMaterial color={look.skin} roughness={0.8} />
        </mesh>
        {/* pelo */}
        <mesh position={[0, 0.06, -0.02]} scale={[1.03, look.hairStyle === 2 ? 0.55 : 0.8, 1.03]}>
          <sphereGeometry args={[0.18, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color={look.hair} roughness={0.9} />
        </mesh>
        {/* ojos */}
        {[-0.06, 0.06].map((x) => (
          <mesh key={x} position={[x, 0.01, 0.165]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        ))}
        {/* auriculares */}
        <mesh position={[0, 0.07, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.185, 0.025, 8, 28, Math.PI]} />
          <meshStandardMaterial color="#141414" roughness={0.4} metalness={0.3} />
        </mesh>
        {[-0.185, 0.185].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 0.05, 14]} />
            <meshStandardMaterial color="#141414" roughness={0.4} metalness={0.3} />
          </mesh>
        ))}
      </group>
      {/* brazos: pivot en el hombro, bajan hacia el teclado */}
      {[-0.24, 0.24].map((x, i) => (
        <group key={x} ref={i === 0 ? leftArm : rightArm} position={[x, 0.37, 0.02]} rotation={[-0.55, 0, 0]}>
          <mesh position={[0, 0, 0.19]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.3, 4, 10]} />
            <meshStandardMaterial color={shirt} roughness={0.75} />
          </mesh>
          <mesh position={[0, 0, 0.4]}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <meshStandardMaterial color={look.skin} roughness={0.8} />
          </mesh>
        </group>
      ))}
      </group>
    </group>
  );
}
