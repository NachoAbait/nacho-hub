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
  designerBanner: DesignerBanner | null;
}

export function OfficeCanvas({ statuses, designerBanner }: Props) {
  const [view, setView] = useState<OfficeView>("BNB");
  const [transitioning, setTransitioning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<SectorFocus | null>(null);
  const [designerWorking, setDesignerWorking] = useState(false);
  // Mientras regenera, el Designer se ve "trabajando" aunque el server diga otra cosa.
  const effective: Record<string, AgentStatus> = designerWorking ? { ...statuses, designer: "working" } : statuses;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al cambiar de piso, los dos quedan visibles mientras la cámara hace el plano de grúa (2,2 s).
  function changeView(next: OfficeView) {
    if (next === view) return;
    setView(next);
    setSelectedId(null);
    setFocus(null);
    setTransitioning(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTransitioning(false), 2300);
  }

  function focusSector(floor: SectorFocus["floor"], tier: Tier | null) {
    setFocus(tier ? { floor, tier } : null);
  }

  // Tocar un agente abre su panel y acerca la cámara a su sector.
  function selectAgent(id: string | null) {
    setSelectedId(id);
    const agent = id ? agentById(id) : undefined;
    if (agent) {
      const floor = view === "AgroScan" || (view === "AMBOS" && !agent.contexts.includes("BNB")) ? "AgroScan" : "BNB";
      setFocus({ floor, tier: agent.tier });
    }
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0a0b10]">
      <Scene
        view={view}
        transitioning={transitioning}
        focus={focus}
        statuses={effective}
        selectedId={selectedId}
        onSelect={selectAgent}
        onFocusSector={focusSector}
      />
      <Hud
        view={view}
        onView={changeView}
        onDesignerWorking={setDesignerWorking}
        selectedId={selectedId}
        focus={focus}
        onClearFocus={() => { setFocus(null); setSelectedId(null); }}
        onClose={() => setSelectedId(null)}
        statuses={effective}
        designerBanner={designerBanner}
      />
    </div>
  );
}
