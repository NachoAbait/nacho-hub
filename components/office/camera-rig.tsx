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

/** Vistas frontales: la cámara mira de frente a la pared del fondo. */
const VIEWS: Record<OfficeView, Shot> = {
  BNB: { position: [0, 13.5, 31], target: [0, 1.2, -1] },
  AgroScan: { position: [0, 13.5 + FLOOR_GAP, 31], target: [0, 1.2 + FLOOR_GAP, -1] },
  AMBOS: { position: [0, 19, 48], target: [0, FLOOR_GAP / 2 + 1.5, -1] },
};

/** Duración del viaje entre vistas, en segundos. Va sincronizado con la animación CSS del overlay. */
export const TRAVEL = 0.9;
/** Fracción del viaje en la que la pantalla está oscura y la cámara "salta" de nivel. */
const CUT = 0.35;

function goalFor(view: OfficeView, focus: SectorFocus | null): Shot {
  if (focus) {
    const sector = SECTORS.find((s) => s.tier === focus.tier)!;
    const y = floorTheme(focus.floor).y;
    const [cx, cz] = sector.center;
    return { position: [cx, y + 7, cz + 11.5], target: [cx, y + 0.9, cz - 0.5] };
  }
  return VIEWS[view];
}

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Travel {
  fromPos: Vector3; fromTgt: Vector3;
  toPos: Vector3; toTgt: Vector3;
  /** +1 sube, -1 baja, 0 zoom (vista general) */
  dir: number;
  elapsed: number;
}

/**
 * Cámara frontal. Entre vistas hace un "ascensor": arranca a moverse, la pantalla
 * se oscurece (overlay CSS), salta de nivel y entra suave en el piso nuevo.
 * Para enfocar un sector amortigua. Después deja orbitar un poco.
 */
export function CameraRig({ view, focus }: { view: OfficeView; focus: SectorFocus | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const damped = useRef({ position: new Vector3(), target: new Vector3(), active: false });
  const travel = useRef<Travel | null>(null);
  const first = useRef(true);

  // Cambio de vista: ascensor
  useEffect(() => {
    if (!controls.current) return;
    const g = goalFor(view, null);
    const toPos = new Vector3(...g.position);
    const toTgt = new Vector3(...g.target);
    if (first.current) {
      // Primera carga: directo a la vista, sin viaje.
      first.current = false;
      camera.position.copy(toPos);
      controls.current.target.copy(toTgt);
      controls.current.update();
      return;
    }
    const fromPos = camera.position.clone();
    const fromTgt = controls.current.target.clone();
    const dir = Math.sign(toPos.y - fromPos.y);
    travel.current = { fromPos, fromTgt, toPos, toTgt, dir, elapsed: 0 };
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
      const t = tr.elapsed / TRAVEL;
      const lift = tr.dir === 0 ? 0 : 2.2 * tr.dir; // cuánto se mueve antes del corte
      if (t < CUT) {
        // arranque: acelera en la dirección del viaje
        const k = easeIn(t / CUT);
        camera.position.set(tr.fromPos.x, tr.fromPos.y + lift * k, tr.fromPos.z - (tr.dir === 0 ? 0 : 1.5 * k));
        c.target.set(tr.fromTgt.x, tr.fromTgt.y + lift * k, tr.fromTgt.z);
      } else {
        // llegada: aparece un poco antes del destino y frena suave
        const k = easeOut((t - CUT) / (1 - CUT));
        const pre = tr.dir === 0 ? 0 : -lift; // viene desde abajo si sube, desde arriba si baja
        camera.position.set(tr.toPos.x, tr.toPos.y + pre * (1 - k), tr.toPos.z + (tr.dir === 0 ? -6 : 1.5) * (1 - k));
        c.target.set(tr.toTgt.x, tr.toTgt.y + pre * (1 - k), tr.toTgt.z);
      }
      c.update();
      if (tr.elapsed >= TRAVEL) travel.current = null;
      return;
    }

    const d = damped.current;
    if (!d.active) return;
    damp3(camera.position, d.position, 0.45, delta);
    damp3(c.target, d.target, 0.45, delta);
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
      minPolarAngle={0.5}
      maxPolarAngle={1.3}
      minAzimuthAngle={-0.7}
      maxAzimuthAngle={0.7}
      onStart={() => { damped.current.active = false; travel.current = null; }}
    />
  );
}
