"use client";

import { STATUS_LABEL, TIERS, agentById, type AgentStatus } from "@/lib/agents";
import type { OfficeView } from "@/components/office/camera-rig";
import { RegenerateButton } from "@/components/dashboard/regenerate-button";

export interface DesignerBanner {
  url: string;
  generatedAt: string;
}

interface Props {
  view: OfficeView;
  onView: (v: OfficeView) => void;
  selectedId: string | null;
  onClose: () => void;
  statuses: Record<string, AgentStatus>;
  designerBanner: DesignerBanner | null;
}

const VIEW_BUTTONS: { id: OfficeView; label: string; hint: string }[] = [
  { id: "BNB", label: "BNB", hint: "Planta baja" },
  { id: "AgroScan", label: "AgroScan", hint: "Primer piso" },
  { id: "AMBOS", label: "Ambos", hint: "Vista general" },
];

const DOT: Record<AgentStatus, string> = { live: "bg-green-500", done: "bg-amber-400", idle: "bg-gray-500" };

export function Hud({ view, onView, selectedId, onClose, statuses, designerBanner }: Props) {
  const agent = selectedId ? agentById(selectedId) : undefined;
  const status = agent ? statuses[agent.id] ?? "idle" : "idle";
  const liveCount = Object.values(statuses).filter((s) => s !== "idle").length;

  return (
    <>
      {/* título */}
      <div className="pointer-events-none absolute left-5 top-5 z-[100] select-none">
        <div className="text-2xl font-black tracking-tight">
          NACHO <span className="text-amber-400">HUB</span>
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/50">
          {liveCount} de {Object.keys(statuses).length} agentes operativos
        </div>
      </div>

      {/* selector de piso */}
      <div className="absolute right-5 top-5 z-[100] flex gap-1 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur">
        {VIEW_BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onView(b.id)}
            title={b.hint}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              view === b.id ? "bg-amber-400 text-black" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* leyenda */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-[100] flex flex-wrap gap-3 text-[11px] text-white/60">
        {(["live", "done", "idle"] as AgentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${DOT[s]}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="text-white/35">· Arrastrá para girar, scroll para zoom, tocá un agente</span>
      </div>

      {/* panel del agente */}
      {agent && (
        <aside className="absolute bottom-5 right-5 top-20 z-[100] flex w-[340px] max-w-[calc(100vw-2.5rem)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-black/80 p-5 backdrop-blur-md">
          <header className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-400">
                {TIERS.find((t) => t.id === agent.tier)?.label}
              </div>
              <h2 className="mt-1 text-xl font-bold leading-tight">{agent.name}</h2>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60">
                <span className={`inline-block h-2 w-2 rounded-full ${DOT[status]}`} />
                {STATUS_LABEL[status]} · Fase {agent.phase}
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full px-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
              ✕
            </button>
          </header>

          <p className="text-sm leading-relaxed text-white/80">{agent.description}</p>

          <div className="text-xs text-white/50">
            Trabaja en: {agent.contexts.join(" y ")}
          </div>

          {agent.id === "designer" && (
            <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Último banner</span>
                <RegenerateButton category="iphone" />
              </div>
              {designerBanner ? (
                <a href={designerBanner.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={designerBanner.url} alt="Último banner de iPhone" className="w-full" />
                </a>
              ) : (
                <p className="text-xs text-white/50">Todavía no hay banners.</p>
              )}
              <a href="/dashboard" className="text-xs text-amber-300 hover:underline">Ver todos los banners →</a>
            </div>
          )}

          {!agent.live && (
            <p className="rounded-lg border border-dashed border-white/15 p-3 text-xs text-white/50">
              Este escritorio está reservado. El agente se construye en la Fase {agent.phase}.
            </p>
          )}
        </aside>
      )}
    </>
  );
}
