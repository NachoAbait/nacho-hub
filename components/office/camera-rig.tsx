"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { damp3 } from "maath/easing";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Tier } from "@/lib/agents";
import { FLOOR_GAP, SECTORS, floorTheme } from "@/lib/office/layout";
import type { BusinessContext } from "@/lib/types";

export type OfficeView = "BNB" | "AgroScan" | "AMBOS";

/** Sector enfocado: piso + tier. */
export interface SectorFocus {
  floor: BusinessContext;
  tier: Tier;
}

const VIEWS: Record<OfficeView, { position: [number, number, number]; target: [number, number, number] }> = {
  BNB: { position: [20, 15, 23], target: [0, 1, 0] },
  AgroScan: { position: [20, 15 + FLOOR_GAP, 23], target: [0, 1 + FLOOR_GAP, 0] },
  AMBOS: { position: [31, 20, 36], target: [0, FLOOR_GAP / 2 + 1, 0] },
};

function goalFor(view: OfficeView, focus: SectorFocus | null) {
  if (focus) {
    const sector = SECTORS.find((s) => s.tier === focus.tier)!;
    const y = floorTheme(focus.floor).y;
    const [cx, cz] = sector.center;
    return { position: [cx + 7.5, y + 6.5, cz + 9] as const, target: [cx, y + 0.9, cz - 0.5] as const };
  }
  return VIEWS[view];
}

/** Mueve la cámara con amortiguación hacia la vista o el sector pedido; después deja orbitar. */
export function CameraRig({ view, focus }: { view: OfficeView; focus: SectorFocus | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const goal = useRef({ position: new Vector3(), target: new Vector3(), active: true });

  useEffect(() => {
    const g = goalFor(view, focus);
    goal.current.position.set(...g.position);
    goal.current.target.set(...g.target);
    goal.current.active = true;
  }, [view, focus]);

  useFrame((_, delta) => {
    const g = goal.current;
    if (!g.active || !controls.current) return;
    damp3(camera.position, g.position, 0.55, delta);
    damp3(controls.current.target, g.target, 0.55, delta);
    controls.current.update();
    if (camera.position.distanceTo(g.position) < 0.02 && controls.current.target.distanceTo(g.target) < 0.02) {
      g.active = false;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={6}
      maxDistance={80}
      minPolarAngle={0.45}
      maxPolarAngle={1.35}
      onStart={() => { goal.current.active = false; }}
    />
  );
}
