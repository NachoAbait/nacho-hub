"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { Tier } from "@/lib/agents";

const TIER_COLOR: Record<Tier, string> = {
  readers: "#3b82f6",
  analysts: "#a855f7",
  creators: "#f59e0b",
  chief: "#ef4444",
};

interface Props {
  tier: Tier;
  /** Velocidad de tipeo. 0 = quieto. */
  energy: number;
  /** Desfase para que no tipeen todos sincronizados. */
  seed: number;
}

/** Muñeco low-poly sentado, mirando a +z, tipeando. */
export function Character({ tier, energy, seed }: Props) {
  const leftArm = useRef<Mesh>(null);
  const rightArm = useRef<Mesh>(null);
  const head = useRef<Mesh>(null);
  const body = useRef<Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * (4 + energy * 6) + seed;
    const amp = 0.025 * (0.4 + energy);
    if (leftArm.current) leftArm.current.position.y = 0.72 + Math.max(0, Math.sin(t)) * amp;
    if (rightArm.current) rightArm.current.position.y = 0.72 + Math.max(0, Math.sin(t + Math.PI)) * amp;
    if (head.current) head.current.rotation.z = Math.sin(t * 0.25) * 0.05;
    if (body.current) body.current.position.y = Math.sin(t * 0.3) * 0.01;
  });

  const color = TIER_COLOR[tier];

  return (
    <group ref={body}>
      {/* torso */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.3, 4, 10]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* cabeza */}
      <mesh ref={head} position={[0, 1.0, 0]} castShadow>
        <sphereGeometry args={[0.19, 20, 20]} />
        <meshStandardMaterial color="#f1c9a5" roughness={0.8} />
      </mesh>
      {/* auriculares */}
      <mesh position={[0, 1.07, 0]}>
        <torusGeometry args={[0.19, 0.035, 8, 24, Math.PI]} />
        <meshStandardMaterial color="#111" roughness={0.5} />
      </mesh>
      <mesh position={[-0.19, 1.0, 0]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0.19, 1.0, 0]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* brazos hacia el teclado */}
      <mesh ref={leftArm} position={[-0.16, 0.72, 0.25]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[0.09, 0.09, 0.45]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh ref={rightArm} position={[0.16, 0.72, 0.25]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[0.09, 0.09, 0.45]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}
