"use client";

import { useEffect, useState } from "react";
import { loadChiefBrief, type ChiefBriefData } from "@/app/actions";
import { AGENTS } from "@/lib/agents";
import { PanelSkeleton } from "@/components/office/skeleton";
import type { BusinessContext } from "@/lib/types";

/** El Daily Brief de Ernesto, como tarjetas: acciones numeradas, alertas si hay, y quién reportó hoy. */
export function ChiefOfStaffPanel({ context }: { context: BusinessContext }) {
  const [loaded, setLoaded] = useState<{ context: BusinessContext; value: ChiefBriefData | null } | null>(null);
  useEffect(() => { loadChiefBrief(context).then((value) => setLoaded({ context, value })); }, [context]);
  const data = loaded?.context === context ? loaded.value : undefined;

  if (data === undefined) return <PanelSkeleton />;
  if (!data || !data.brief) return <p className="text-xs text-white/50">Todavía no hay Daily Brief para hoy.</p>;

  const { brief } = data;
  const personaOf = (id: string) => AGENTS.find((a) => a.id === id)?.persona ?? id;

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <p className="text-[12px] leading-relaxed text-white/85">{brief.summary}</p>

      <div className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Para hoy</h3>
        {brief.actions.map((a, i) => (
          <div key={i} className="flex gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2">
            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-amber-400/20 text-[10px] font-bold text-amber-300">{i + 1}</span>
            <div className="min-w-0">
              <div className="font-semibold text-white/90">{a.title}</div>
              <div className="text-white/60">{a.why}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-white/35">{a.time}</div>
            </div>
          </div>
        ))}
      </div>

      {brief.alerts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-red-400/25 bg-red-400/5 p-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">⚠️ Alertas</h3>
          <ul className="flex flex-col gap-0.5">
            {brief.alerts.map((a, i) => <li key={i} className="text-white/75">{a}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {data.reported.map((id) => (
          <span key={id} className="rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] text-green-200">{personaOf(id)} ✓</span>
        ))}
        {data.missing.map((id) => (
          <span key={id} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/40">{personaOf(id)} —</span>
        ))}
      </div>
    </div>
  );
}
