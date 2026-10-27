"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, Html, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import type { AgentStatus, Tier } from "@/lib/agents";
import { FLOORS } from "@/lib/office/layout";
import { Floor } from "@/components/office/floor";
import { CameraRig, type OfficeView, type SectorFocus } from "@/components/office/camera-rig";

interface Props {
  view: OfficeView;
  /** Mientras la cámara viaja entre pisos se ven los dos. */
  transitioning: boolean;
  focus: SectorFocus | null;
  statuses: Record<string, AgentStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFocusSector: (floor: SectorFocus["floor"], tier: Tier | null) => void;
}

export default function Scene({ view, transitioning, focus, statuses, selectedId, onSelect, onFocusSector }: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 30, near: 0.5, far: 200, position: [20, 15, 23] }}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#0a0b10"]} />
      <fog attach="fog" args={["#0a0b10", 70, 130]} />
      <SoftShadows size={18} samples={12} focus={0.6} />
      <Environment preset="city" environmentIntensity={0.35} />
      <hemisphereLight args={["#ffffff", "#30261a", 0.35]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[12, 24, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
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
          focusedTier={focus?.floor === theme.id ? focus.tier : null}
          onSelect={onSelect}
          onFocusSector={(tier) => onFocusSector(theme.id, tier)}
          visible={view === "AMBOS" || view === theme.id || transitioning}
        />
      ))}
      <CameraRig view={view} focus={focus} />
      <EffectComposer multisampling={4}>
        <Bloom luminanceThreshold={1} mipmapBlur intensity={0.55} radius={0.6} />
        <Vignette eskil={false} offset={0.2} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
