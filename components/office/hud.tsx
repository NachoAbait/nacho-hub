"use client";

import { STATUS_COLOR, STATUS_LABEL, TIERS, agentById, type AgentStatus } from "@/lib/agents";
import type { OfficeView, SectorFocus } from "@/components/office/camera-rig";
import { RegenerateButton } from "@/components/dashboard/regenerate-button";
import { BRIEFS } from "@/lib/agent-briefs";
import { RunNowButton } from "@/components/office/run-now-button";
import { PriceReaderPanel } from "@/components/office/price-reader-panel";
import { AgentReportPanel } from "@/components/office/agent-report-panel";
import { REGISTERED_AGENT_IDS } from "@/lib/agents";

export interface DesignerBanner {
  url: string;
  generatedAt: string;
}

interface Props {
  view: OfficeView;
  onView: (v: OfficeView) => void;
  /** Avisa cuando el Designer está regenerando, para animarlo como "trabajando". */
  onDesignerWorking: (working: boolean) => void;
  selectedId: string | null;
  focus: SectorFocus | null;
  onClearFocus: () => void;
  onClose: () => void;
  statuses: Record<string, AgentStatus>;
  designerBanner: DesignerBanner | null;
}

const CONTEXT_LABEL: Record<string, string> = { BNB: "BNB", AgroScan: "AgroScan", GLOBAL: "Economía" };

const VIEW_BUTTONS: { id: OfficeView; label: string; hint: string }[] = [
  { id: "BNB", label: "BNB", hint: "Planta baja" },
  { id: "AgroScan", label: "AgroScan", hint: "Primer piso" },
  { id: "GLOBAL", label: "Economía", hint: "Segundo piso" },
  { id: "AMBOS", label: "Ambos", hint: "Vista general (BNB + AgroScan)" },
];


export function Hud({ view, onView, onDesignerWorking, selectedId, focus, onClearFocus, onClose, statuses, designerBanner }: Props) {
  const agent = selectedId ? agentById(selectedId) : undefined;
  const brief = agent ? BRIEFS[agent.id] : undefined;
  const status = agent ? statuses[agent.id] ?? "idle" : "idle";
  const liveCount = Object.values(statuses).filter((s) => s !== "idle").length;
  const workingCount = Object.values(statuses).filter((s) => s === "working").length;

  return (
    <>
      {/* título */}
      <div className="pointer-events-none absolute left-5 top-5 z-[100] select-none">
        <div className="text-2xl font-black tracking-tight">
          NACHO <span className="text-amber-400">HUB</span>
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/50">
          {liveCount} de {Object.keys(statuses).length} agentes operativos
          {workingCount > 0 && <span className="text-green-400"> · {workingCount} trabajando ahora</span>}
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

      {/* sector enfocado */}
      {focus && (
        <button
          type="button"
          onClick={onClearFocus}
          className="absolute left-1/2 top-5 z-[100] -translate-x-1/2 rounded-full border border-amber-400/40 bg-black/75 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-black"
        >
          ← Equipo {TIERS.find((t) => t.id === focus.tier)?.label} · {CONTEXT_LABEL[focus.floor]} · volver al piso
        </button>
      )}

      {/* leyenda */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-[100] flex flex-wrap gap-3 text-[11px] text-white/60">
        {(["working", "done", "live", "idle"] as AgentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="text-white/35">· Tocá una alfombra para acercarte al sector, un agente para ver su panel</span>
      </div>

      {/* panel del agente */}
      {agent && (
        <aside className={`absolute bottom-5 right-5 top-20 z-[100] flex ${agent.id === "price-reader" ? "w-[480px]" : "w-[340px]"} max-w-[calc(100vw-2.5rem)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-black/80 p-5 backdrop-blur-md`}>
          <header className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-400">
                {TIERS.find((t) => t.id === agent.tier)?.label}
              </div>
              <h2 className="mt-1 text-xl font-bold leading-tight">
                {agent.persona} <span className="text-base font-medium text-white/50">· {agent.name}</span>
              </h2>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60">
                <span className={`inline-block h-2 w-2 rounded-full ${status === "working" ? "animate-pulse" : ""}`} style={{ background: STATUS_COLOR[status] }} />
                {STATUS_LABEL[status]} · Fase {agent.phase}
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full px-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
              ✕
            </button>
          </header>

          {/* Descripción fija del puesto: colapsada, para que lo que el agente está haciendo/hizo
              se vea de entrada sin tener que bajar. */}
          {brief ? (
            <details className="group rounded-lg border border-white/10">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50 hover:text-white/80">
                Qué hace este puesto
                <span className="text-white/30 transition group-open:rotate-180">⌄</span>
              </summary>
              <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
                <p className="text-sm leading-relaxed text-white/90">“{brief.summary}”</p>
                <ol className="flex flex-col gap-2">
                  {brief.steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-white/80">
                      <span className="mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full bg-amber-400/15 text-[10px] font-bold text-amber-300">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-[12px]">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Fuentes</div>
                    <div className="mt-1 text-white/80">{brief.sources.join(" · ")}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Entrega</div>
                    <div className="mt-1 text-white/80">{brief.delivers}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Cuándo corre</div>
                    <div className="mt-1 text-white/80">{brief.schedule}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Trabaja en</div>
                    <div className="mt-1 text-white/80">{agent.contexts.map((c) => CONTEXT_LABEL[c]).join(" y ")}</div>
                  </div>
                </div>
              </div>
            </details>
          ) : (
            <p className="text-sm leading-relaxed text-white/80">{agent.description}</p>
          )}

          {REGISTERED_AGENT_IDS.includes(agent.id) && agent.id !== "designer" && <RunNowButton agentId={agent.id} />}
          {agent.id === "price-reader" && <PriceReaderPanel />}

          {agent.id === "price-analyst" && (
            <a
              href="/api/reports/price-matrix"
              className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-300 transition hover:bg-amber-400/20"
            >
              Descargar comparativa de hoy (Excel)
            </a>
          )}

          {agent.id === "designer" && (
            <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Último banner</span>
                <div className="flex flex-col items-end gap-2"><RunNowButton agentId="designer" onPendingChange={onDesignerWorking} /><RegenerateButton category="iphone" onPendingChange={onDesignerWorking} /></div>
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

          {focus && REGISTERED_AGENT_IDS.includes(agent.id) && agent.id !== "price-reader" && agent.id !== "designer" && (
            <AgentReportPanel agentId={agent.id} context={focus.floor} />
          )}

          {!agent.live && !REGISTERED_AGENT_IDS.includes(agent.id) && (
            <p className="rounded-lg border border-dashed border-white/15 p-3 text-xs text-white/50">
              Este escritorio está reservado. El agente se construye en la Fase {agent.phase}.
            </p>
          )}
        </aside>
      )}
    </>
  );
}
