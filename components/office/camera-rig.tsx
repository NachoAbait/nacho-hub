"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { damp3 } from "maath/easing";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FLOOR_GAP } from "@/lib/office/layout";

export type OfficeView = "BNB" | "AgroScan" | "AMBOS";

const VIEWS: Record<OfficeView, { position: [number, number, number]; target: [number, number, number] }> = {
  BNB: { position: [20, 15, 23], target: [0, 1, 0] },
  AgroScan: { position: [20, 15 + FLOOR_GAP, 23], target: [0, 1 + FLOOR_GAP, 0] },
  AMBOS: { position: [31, 20, 36], target: [0, FLOOR_GAP / 2 + 1, 0] },
};

/** Mueve la cámara con amortiguación hacia la vista pedida; después deja orbitar. */
export function CameraRig({ view }: { view: OfficeView }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const goal = useRef({ position: new Vector3(), target: new Vector3(), active: true });

  useEffect(() => {
    goal.current.position.set(...VIEWS[view].position);
    goal.current.target.set(...VIEWS[view].target);
    goal.current.active = true;
  }, [view]);

  useFrame((_, delta) => {
    const g = goal.current;
    if (!g.active || !controls.current) return;
    damp3(camera.position, g.position, 0.6, delta);
    damp3(controls.current.target, g.target, 0.6, delta);
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
      minDistance={14}
      maxDistance={80}
      minPolarAngle={0.5}
      maxPolarAngle={1.35}
      onStart={() => { goal.current.active = false; }}
    />
  );
}
