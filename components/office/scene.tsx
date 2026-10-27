"use client";

import { Canvas } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { AgentStatus } from "@/lib/agents";
import { FLOORS } from "@/lib/office/layout";
import { Floor } from "@/components/office/floor";
import { CameraRig, type OfficeView } from "@/components/office/camera-rig";

interface Props {
  view: OfficeView;
  /** Mientras la cámara viaja entre pisos se ven los dos. */
  transitioning: boolean;
  statuses: Record<string, AgentStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function Scene({ view, transitioning, statuses, selectedId, onSelect }: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 30, near: 0.5, far: 200, position: [20, 15, 23] }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#0a0b10"]} />
      <fog attach="fog" args={["#0a0b10", 70, 130]} />
      <hemisphereLight args={["#ffffff", "#30261a", 0.55]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[12, 24, 10]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-far={70}
      />
      {/* drei pierde el primer <Html transform> de la escena (verificado en dev y prod): este vacío absorbe el bug. */}
      <Html transform position={[0, -50, 0]} style={{ pointerEvents: "none" }}>
        <span />
      </Html>
      {FLOORS.map((theme) => (
        <Floor
          key={theme.id}
          theme={theme}
          statuses={statuses}
          selectedId={selectedId}
          onSelect={onSelect}
          visible={view === "AMBOS" || view === theme.id || transitioning}
        />
      ))}
      <CameraRig view={view} />
    </Canvas>
  );
}
