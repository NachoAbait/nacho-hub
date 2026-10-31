"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { loadAgentReport, type AgentReportData } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import type { BusinessContext } from "@/lib/types";

/**
 * Último informe de un agente, en el negocio que se está mirando. Lo usan todos los agentes
 * que no tienen un panel especial propio (Lucas y Nico sí lo tienen, por su UI particular).
 */
export function AgentReportPanel({ agentId, context }: { agentId: string; context: BusinessContext }) {
  const key = `${agentId}:${context}`;
  const [loaded, setLoaded] = useState<{ key: string; report: AgentReportData | null } | null>(null);

  useEffect(() => {
    let active = true;
    loadAgentReport(agentId, context).then((r) => { if (active) setLoaded({ key, report: r }); });
    return () => { active = false; };
  }, [agentId, context, key]);

  // Si todavía no llegó la respuesta para este agente/negocio, mostramos "cargando" en vez del dato viejo.
  const report = loaded?.key === key ? loaded.report : undefined;

  return (
    <section className="flex flex-col gap-2 border-t border-white/10 pt-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">
        Último informe{report?.date ? ` · ${report.date}` : ""}
      </h3>
      {report === undefined ? (
        <PanelSkeleton />
      ) : report ? (
        <div className="text-[13px] leading-relaxed text-white/80 [&_a]:text-amber-300 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
          <Markdown>{report.markdown}</Markdown>
        </div>
      ) : (
        <p className="text-xs text-white/50">Todavía no hay informes para este negocio.</p>
      )}
    </section>
  );
}
