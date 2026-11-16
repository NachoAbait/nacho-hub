"use client";

import { useEffect, useState } from "react";
import { loadBacklogItems, type BacklogItem } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

const STATUS_STYLE: Record<BacklogItem["status"], { label: string; dot: string; box: string }> = {
  pending: { label: "Pendiente", dot: "bg-white/40", box: "border-white/10 bg-white/5" },
  in_progress: { label: "En curso", dot: "bg-sky-400", box: "border-sky-400/25 bg-sky-400/5" },
  blocked: { label: "Esperando tu OK", dot: "bg-amber-400", box: "border-amber-400/30 bg-amber-400/5" },
  done: { label: "Hecho", dot: "bg-emerald-400", box: "border-emerald-400/20 bg-emerald-400/5" },
};

/**
 * El backlog de "Ernesto autónomo" (rutina en la nube, corre sola cada 1h, no depende de que la
 * computadora esté prendida): una tarjeta por ítem con su estado, nunca un informe en texto.
 */
export function ErnestoBacklogPanel({ project }: { project: string }) {
  const [loaded, setLoaded] = useState<{ project: string; items: BacklogItem[] } | null>(null);
  useEffect(() => { loadBacklogItems(project).then((items) => setLoaded({ project, items })); }, [project]);
  const items = loaded?.project === project ? loaded.items : undefined;

  if (items === undefined) return <PanelSkeleton />;
  if (items.length === 0) return <p className="text-xs text-white/50">Todavía no hay pendientes cargados para Ernesto.</p>;

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        Backlog de Ernesto (autónomo · corre solo cada 1h)
      </h3>
      <div className="flex flex-col gap-2 text-[11px]">
        {items.map((item) => {
          const style = STATUS_STYLE[item.status];
          return (
            <div key={item.id} className={`flex flex-col gap-1 rounded-lg border p-2 ${style.box}`}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 flex-none rounded-full ${style.dot}`} />
                <span className="min-w-0 flex-1 truncate font-semibold text-white/90">{item.title}</span>
                <span className="flex-none text-[10px] uppercase tracking-wider text-white/40">{style.label}</span>
              </div>
              {item.blockedReason && <p className="text-white/70">{item.blockedReason}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
