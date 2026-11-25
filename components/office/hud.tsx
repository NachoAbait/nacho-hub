"use client";

import { useEffect } from "react";
import { STATUS_COLOR, STATUS_LABEL, TIERS, agentById, type AgentStatus } from "@/lib/agents";
import type { OfficeView, SectorFocus } from "@/components/office/camera-rig";
import { RegenerateButton } from "@/components/dashboard/regenerate-button";
import { BRIEFS } from "@/lib/agent-briefs";
import { RunNowButton } from "@/components/office/run-now-button";
import { PriceReaderPanel } from "@/components/office/price-reader-panel";
import { PriceAnalystPanel } from "@/components/office/price-analyst-panel";
import { PriceHistorianPanel } from "@/components/office/price-historian-panel";
import { StockAnalystPanel } from "@/components/office/stock-analyst-panel";
import { CatalogManagerPanel } from "@/components/office/catalog-manager-panel";
import { MarketWatcherPanel } from "@/components/office/market-watcher-panel";
import { ChiefOfStaffPanel } from "@/components/office/chief-of-staff-panel";
import { ErnestoBacklogPanel } from "@/components/office/ernesto-backlog-panel";
import { CustomerConversationsPanel } from "@/components/office/customer-conversations-panel";
import { ContentCreatorPanel } from "@/components/office/content-creator-panel";
import { CopyWriterPanel } from "@/components/office/copy-writer-panel";
import { GlobalAnalystPanel } from "@/components/office/global-analyst-panel";
import { CompetitorScraperPanel } from "@/components/office/competitor-scraper-panel";
import { ReelScoutPanel } from "@/components/office/reel-scout-panel";
import { VideoEditorPanel } from "@/components/office/video-editor-panel";
import { AgentReportPanel } from "@/components/office/agent-report-panel";
import { REGISTERED_AGENT_IDS } from "@/lib/agents";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

export interface DesignerBanner {
  category: Category;
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
  designerBanners: DesignerBanner[];
}

const CONTEXT_LABEL: Record<string, string> = { BNB: "BNB", AgroScan: "AgroScan", GLOBAL: "Economía" };

/** A qué día de ART (UTC-3 fijo) corresponde un instante, como clave comparable. */
function artDateKey(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Para que se note a simple vista si un banner es de hoy o quedó viejo (pedido de Nacho: "¿cómo sé
 * que está actualizado?") — sin esto, el panel mostraba la imagen sin decir cuándo se generó. */
function bannerFreshness(generatedAt: string): { label: string; fresh: boolean } {
  const genKey = artDateKey(generatedAt);
  const todayKey = artDateKey(new Date().toISOString());
  if (genKey === todayKey) {
    const time = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(generatedAt));
    return { label: `Hoy ${time}`, fresh: true };
  }
  const days = Math.round((Date.parse(todayKey) - Date.parse(genKey)) / 86400_000);
  return { label: days === 1 ? "Ayer" : `Hace ${days} días`, fresh: false };
}

const VIEW_BUTTONS: { id: OfficeView; label: string; hint: string }[] = [
  { id: "BNB", label: "BNB", hint: "Planta baja" },
  { id: "AgroScan", label: "AgroScan", hint: "Primer piso" },
  { id: "GLOBAL", label: "Economía", hint: "Segundo piso" },
  { id: "AMBOS", label: "Ambos", hint: "Vista general (BNB + AgroScan)" },
];


export function Hud({ view, onView, onDesignerWorking, selectedId, focus, onClearFocus, onClose, statuses, designerBanners }: Props) {
  const agent = selectedId ? agentById(selectedId) : undefined;
  const brief = agent ? BRIEFS[agent.id] : undefined;
  const status = agent ? statuses[agent.id] ?? "idle" : "idle";
  const liveCount = Object.values(statuses).filter((s) => s !== "idle").length;
  const workingCount = Object.values(statuses).filter((s) => s === "working").length;

  // Siempre tiene que haber una salida con el teclado, no solo la cruz: el video-editor ya nos
  // quemó una vez con una vista sin forma de volver atrás.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onClose]);

  return (
    <>
      {/* título */}
      <div className="pointer-events-none absolute left-3 top-3 z-[100] select-none sm:left-5 sm:top-5">
        <div className="text-lg font-black tracking-tight sm:text-2xl">
          NACHO <span className="text-amber-400">HUB</span>
        </div>
        <div className="hidden text-[11px] font-semibold uppercase tracking-[0.3em] text-white/50 sm:block">
          {liveCount} de {Object.keys(statuses).length} agentes operativos
          {workingCount > 0 && <span className="text-green-400"> · {workingCount} trabajando ahora</span>}
        </div>
      </div>

      {/* selector de piso */}
      <div className="absolute right-3 top-3 z-[100] flex gap-0.5 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur sm:right-5 sm:top-5 sm:gap-1">
        {VIEW_BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onView(b.id)}
            title={b.hint}
            className={`rounded-full px-2 py-1 text-[11px] font-semibold transition sm:px-4 sm:py-1.5 sm:text-sm ${
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
          className="absolute left-1/2 top-14 z-[100] -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-400/40 bg-black/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur transition hover:bg-black sm:top-5 sm:px-4 sm:py-1.5 sm:text-sm"
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

      {/* panel del agente: ocupa el 70% derecho de la pantalla (el otro 30% es el 3D, ver
          office-canvas.tsx), en vez de flotar como tarjeta chica sobre la escena. */}
      {agent && (
        <aside key={agent.id} className="panel-enter absolute bottom-5 left-[calc(30%+1.25rem)] right-5 top-20 z-[100] flex min-w-[380px] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-6 backdrop-blur-md">
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
            <div className="border-t border-white/10 pt-4">
              <PriceAnalystPanel />
            </div>
          )}

          {agent.id === "stock-analyst" && (
            <div className="border-t border-white/10 pt-4">
              <StockAnalystPanel />
            </div>
          )}

          {agent.id === "catalog-manager" && (
            <div className="border-t border-white/10 pt-4">
              <CatalogManagerPanel />
            </div>
          )}

          {agent.id === "price-historian" && (
            <div className="border-t border-white/10 pt-4">
              <PriceHistorianPanel />
            </div>
          )}

          {agent.id === "market-watcher" && focus && (
            <div className="border-t border-white/10 pt-4">
              <MarketWatcherPanel context={focus.floor} />
            </div>
          )}

          {agent.id === "chief-of-staff" && focus && (
            <div className="border-t border-white/10 pt-4">
              <ChiefOfStaffPanel context={focus.floor} />
            </div>
          )}

          {agent.id === "chief-of-staff" && focus?.floor === "BNB" && <ErnestoBacklogPanel project="BNB" />}
          {agent.id === "chief-of-staff" && focus?.floor === "BNB" && <CustomerConversationsPanel />}

          {agent.id === "content-creator" && focus && (
            <div className="border-t border-white/10 pt-4">
              <ContentCreatorPanel context={focus.floor} />
            </div>
          )}

          {agent.id === "copy-writer" && focus && (
            <div className="border-t border-white/10 pt-4">
              <CopyWriterPanel context={focus.floor} />
            </div>
          )}

          {agent.id === "global-analyst" && (
            <div className="border-t border-white/10 pt-4">
              <GlobalAnalystPanel />
            </div>
          )}

          {agent.id === "competitor-scraper" && focus && (
            <div className="border-t border-white/10 pt-4">
              <CompetitorScraperPanel context={focus.floor} />
            </div>
          )}

          {agent.id === "reel-scout" && (
            <div className="border-t border-white/10 pt-4">
              <ReelScoutPanel />
            </div>
          )}

          {agent.id === "video-editor" && (
            <div className="border-t border-white/10 pt-4">
              <VideoEditorPanel />
            </div>
          )}

          {agent.id === "designer" && (
            <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Banners · último por categoría</span>
                <RunNowButton agentId="designer" onPendingChange={onDesignerWorking} />
              </div>
              {designerBanners.length ? (
                // Ancho fijo + snap: se desliza una categoría a la vez (como un carrusel), en vez
                // de un <img> suelto a lo ancho del panel, que con el panel agrandado se veía
                // gigante y deforme (la imagen es 9:16, no cuadrada).
                <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
                  {designerBanners.map((b) => {
                    const freshness = bannerFreshness(b.generatedAt);
                    return (
                    <div key={b.category} className="flex w-[200px] flex-none snap-center flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white/80">{CATEGORY_LABEL[b.category]}</span>
                        <RegenerateButton category={b.category} onPendingChange={onDesignerWorking} />
                      </div>
                      <span
                        className={`self-start rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          freshness.fresh ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"
                        }`}
                      >
                        {freshness.label}
                      </span>
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-black"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.url} alt={`Banner ${CATEGORY_LABEL[b.category]}`} className="h-full w-full object-cover" />
                      </a>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/50">Todavía no hay banners.</p>
              )}
              <a href="/dashboard" className="text-xs text-amber-300 hover:underline">Ver todos los banners →</a>
            </div>
          )}

          {focus && REGISTERED_AGENT_IDS.includes(agent.id) && agent.id !== "price-reader" && agent.id !== "designer" && agent.id !== "price-analyst" && agent.id !== "price-historian" && agent.id !== "stock-analyst" && agent.id !== "catalog-manager" && agent.id !== "market-watcher" && agent.id !== "chief-of-staff" && agent.id !== "content-creator" && agent.id !== "copy-writer" && agent.id !== "global-analyst" && agent.id !== "competitor-scraper" && agent.id !== "reel-scout" && agent.id !== "video-editor" && (
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
