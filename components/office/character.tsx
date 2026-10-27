"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { Tier } from "@/lib/agents";

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
  /** Velocidad de tipeo. 0 = quieto. */
  energy: number;
  /** Desfase y variación de aspecto. */
  seed: number;
}

/** Muñeco low-poly sentado, mirando a +z, tipeando. */
export function Character({ tier, energy, seed }: Props) {
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const head = useRef<Group>(null);
  const body = useRef<Group>(null);
  const torso = useRef<Mesh>(null);

  const look = useMemo(() => {
    const k = Math.abs(Math.floor(seed * 7.31));
    return { skin: SKINS[k % SKINS.length], hair: HAIRS[(k * 3) % HAIRS.length], hairStyle: k % 3 };
  }, [seed]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const typing = t * (4 + energy * 7) + seed;
    const amp = 0.06 * (0.3 + energy);
    if (leftArm.current) leftArm.current.rotation.x = -0.55 + Math.max(0, Math.sin(typing)) * amp;
    if (rightArm.current) rightArm.current.rotation.x = -0.55 + Math.max(0, Math.sin(typing + Math.PI)) * amp;
    if (head.current) {
      head.current.rotation.z = Math.sin(t * 0.8 + seed) * 0.04;
      head.current.rotation.x = 0.12 + Math.sin(t * 0.5 + seed) * 0.03;
    }
    if (torso.current) torso.current.scale.y = 1 + Math.sin(t * 1.6 + seed) * 0.012;
  });

  const shirt = TIER_COLOR[tier];

  return (
    <group ref={body}>
      {/* piernas (sentado) */}
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
      {/* torso */}
      <mesh ref={torso} position={[0, 0.66, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.3, 6, 14]} />
        <meshStandardMaterial color={shirt} roughness={0.75} />
      </mesh>
      {/* hombros */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.82, 0]} castShadow>
          <sphereGeometry args={[0.085, 12, 12]} />
          <meshStandardMaterial color={shirt} roughness={0.75} />
        </mesh>
      ))}
      {/* cuello */}
      <mesh position={[0, 0.95, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.1, 10]} />
        <meshStandardMaterial color={look.skin} roughness={0.8} />
      </mesh>
      {/* cabeza */}
      <group ref={head} position={[0, 1.13, 0]}>
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
        <group key={x} ref={i === 0 ? leftArm : rightArm} position={[x, 0.82, 0.02]} rotation={[-0.55, 0, 0]}>
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
  );
}
