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

type Vec = [number, number, number];
interface Shot { position: Vec; target: Vec }

const VIEWS: Record<OfficeView, Shot> = {
  BNB: { position: [20, 15, 23], target: [0, 1, 0] },
  AgroScan: { position: [20, 15 + FLOOR_GAP, 23], target: [0, 1 + FLOOR_GAP, 0] },
  AMBOS: { position: [31, 20, 36], target: [0, FLOOR_GAP / 2 + 1, 0] },
};

/** Duración del plano de grúa entre vistas, en segundos. */
const TRAVEL = 2.2;

function goalFor(view: OfficeView, focus: SectorFocus | null): Shot {
  if (focus) {
    const sector = SECTORS.find((s) => s.tier === focus.tier)!;
    const y = floorTheme(focus.floor).y;
    const [cx, cz] = sector.center;
    return { position: [cx + 7.5, y + 6.5, cz + 9], target: [cx, y + 0.9, cz - 0.5] };
  }
  return VIEWS[view];
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Curva de Bézier cuadrática: sale por afuera del edificio para no atravesar la losa. */
function bezier(out: Vector3, a: Vector3, c: Vector3, b: Vector3, t: number) {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

interface Travel {
  fromPos: Vector3; fromTgt: Vector3;
  ctrlPos: Vector3; ctrlTgt: Vector3;
  toPos: Vector3; toTgt: Vector3;
  elapsed: number;
}

/**
 * Cámara: entre vistas (pisos / general) hace un plano de grúa por afuera del edificio;
 * para enfocar un sector amortigua. Después deja orbitar.
 */
export function CameraRig({ view, focus }: { view: OfficeView; focus: SectorFocus | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const damped = useRef({ position: new Vector3(), target: new Vector3(), active: false });
  const travel = useRef<Travel | null>(null);
  const tmp = useRef({ p: new Vector3(), t: new Vector3() });

  // Cambio de vista: plano de grúa
  useEffect(() => {
    if (!controls.current) return;
    const g = goalFor(view, null);
    const toPos = new Vector3(...g.position);
    const toTgt = new Vector3(...g.target);
    const fromPos = camera.position.clone();
    const fromTgt = controls.current.target.clone();
    // Punto de control: afuera del edificio, a mitad de altura, más lejos que ambos extremos
    const midY = (fromPos.y + toPos.y) / 2;
    const ctrlPos = new Vector3(Math.max(fromPos.x, toPos.x) + 16, midY + 7, Math.max(fromPos.z, toPos.z) + 18);
    const ctrlTgt = new Vector3((fromTgt.x + toTgt.x) / 2 + 2, (fromTgt.y + toTgt.y) / 2 + 2, (fromTgt.z + toTgt.z) / 2 + 2);
    travel.current = { fromPos, fromTgt, ctrlPos, ctrlTgt, toPos, toTgt, elapsed: 0 };
    damped.current.active = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Foco de sector: amortiguado (recorridos cortos)
  useEffect(() => {
    const g = goalFor(view, focus);
    damped.current.position.set(...g.position);
    damped.current.target.set(...g.target);
    damped.current.active = true;
    if (focus) travel.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useFrame((_, rawDelta) => {
    const c = controls.current;
    if (!c) return;
    const delta = Math.min(rawDelta, 0.1); // en máquinas lentas el viaje sigue siendo suave

    const tr = travel.current;
    if (tr) {
      tr.elapsed = Math.min(TRAVEL, tr.elapsed + delta);
      const t = easeInOut(tr.elapsed / TRAVEL);
      bezier(tmp.current.p, tr.fromPos, tr.ctrlPos, tr.toPos, t);
      bezier(tmp.current.t, tr.fromTgt, tr.ctrlTgt, tr.toTgt, t);
      camera.position.copy(tmp.current.p);
      c.target.copy(tmp.current.t);
      c.update();
      if (tr.elapsed >= TRAVEL) travel.current = null;
      return;
    }

    const d = damped.current;
    if (!d.active) return;
    damp3(camera.position, d.position, 0.55, delta);
    damp3(c.target, d.target, 0.55, delta);
    c.update();
    if (camera.position.distanceTo(d.position) < 0.02 && c.target.distanceTo(d.target) < 0.02) d.active = false;
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
      onStart={() => { damped.current.active = false; travel.current = null; }}
    />
  );
}
