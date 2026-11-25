"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { agentById, type AgentStatus, type Tier } from "@/lib/agents";
import type { OfficeView, SectorFocus } from "@/components/office/camera-rig";
import { Hud, type DesignerBanner } from "@/components/office/hud";

// WebGL solo existe en el browser: la escena no se renderiza en el server.
const Scene = dynamic(() => import("@/components/office/scene"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-white/40">Armando la oficina…</div>,
});

interface Props {
  statuses: Record<string, AgentStatus>;
  designerBanners: DesignerBanner[];
}

export function OfficeCanvas({ statuses, designerBanners }: Props) {
  const [view, setView] = useState<OfficeView>("BNB");
  // Efecto de ascensor: dirección y un contador para reiniciar la animación CSS en cada viaje.
  const [fx, setFx] = useState<{ dir: "up" | "down" | "zoom"; key: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<SectorFocus | null>(null);
  const [designerWorking, setDesignerWorking] = useState(false);
  // Mientras regenera, el Designer se ve "trabajando" aunque el server diga otra cosa.
  const effective: Record<string, AgentStatus> = designerWorking ? { ...statuses, designer: "working" } : statuses;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function changeView(next: OfficeView) {
    if (next === view) return;
    const level = (v: OfficeView) => (v === "BNB" ? 0 : v === "AgroScan" ? 1 : v === "GLOBAL" ? 2 : 0.5);
    const dir = next === "AMBOS" || view === "AMBOS" ? "zoom" : level(next) > level(view) ? "up" : "down";
    setView(next);
    setSelectedId(null);
    setFocus(null);
    setFx({ dir, key: Date.now() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFx(null), 1000);
  }

  function focusSector(floor: SectorFocus["floor"], tier: Tier | null) {
    setFocus(tier ? { floor, tier } : null);
  }

  // Tocar un agente abre su panel y acerca la cámara a su sector.
  function selectAgent(id: string | null) {
    setSelectedId(id);
    const agent = id ? agentById(id) : undefined;
    if (agent) {
      // "Ambos" solo cubre BNB + AgroScan (el piso Economía no es "de ningún negocio" y se ve solo en su propia vista).
      const floor = view === "AMBOS" ? (agent.contexts.includes("BNB") ? "BNB" : "AgroScan") : view;
      setFocus({ floor, tier: agent.tier, agentId: agent.id });
    }
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0a0b10]">
      {/* Con un agente seleccionado, el 3D se achica a una columna angosta ("ahí está, sentado
          trabajando") y el panel de info pasa a ocupar el resto de la pantalla (ver Hud). Sin
          selección, el 3D ocupa todo como siempre. */}
      <div className={`absolute inset-y-0 left-0 transition-[width] duration-300 ease-out ${selectedId ? "w-[30%] min-w-[280px]" : "w-full"}`}>
        <Scene
          view={view}
          focus={focus}
          statuses={effective}
          selectedId={selectedId}
          onSelect={selectAgent}
          onFocusSector={focusSector}
        />
      </div>
      {fx && <div key={fx.key} className={`elevator-fx ${fx.dir}`} aria-hidden />}
      <Hud
        view={view}
        onView={changeView}
        onDesignerWorking={setDesignerWorking}
        selectedId={selectedId}
        focus={focus}
        onClearFocus={() => { setFocus(null); setSelectedId(null); }}
        onClose={() => setSelectedId(null)}
        statuses={effective}
        designerBanners={designerBanners}
      />
    </div>
  );
}
