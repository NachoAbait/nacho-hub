"use client";

import { useEffect, useState, useTransition } from "react";
import { applyCatalogVisibility, createCatalogProduct, loadCatalogManagerPanel, setCatalogManagerAuto, type CatalogManagerData } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import { CATEGORY_LABEL } from "@/lib/types";

const btn = "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";

/** El panel de Bruno: modo automático o manual (vos lo elegís), los cambios de visibilidad
 * esperando confirmación uno por uno, y los modelos nuevos listos para crear con un clic. */
export function CatalogManagerPanel() {
  const [data, setData] = useState<CatalogManagerData | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const reload = () => { loadCatalogManagerPanel().then(setData); };
  useEffect(() => { reload(); }, []);

  if (data === undefined) return <PanelSkeleton />;

  function run(key: string, action: () => Promise<{ message: string }>) {
    setPendingId(key);
    start(async () => {
      const r = await action();
      setMsg(r.message);
      setPendingId(null);
      reload();
    });
  }

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
        <div>
          <div className="font-semibold text-white/90">Modo {data.auto ? "automático" : "manual"}</div>
          <div className="text-white/45">{data.auto ? "Oculta/muestra solo, sin pedirte nada." : "Te deja confirmar cada cambio uno por uno."}</div>
        </div>
        <button
          type="button"
          className={btn}
          disabled={pendingId === "auto-toggle"}
          onClick={() => run("auto-toggle", () => setCatalogManagerAuto(!data.auto))}
        >
          {data.auto ? "Pasar a manual" : "Pasar a automático"}
        </button>
      </div>

      {data.auto ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-white/45">Ocultados hoy</div>
            <div className="mt-0.5 font-bold text-white/90">{data.hidden}</div>
            <div className="text-white/40">sin cotización de nadie</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-white/45">Vueltos a mostrar</div>
            <div className="mt-0.5 font-bold text-white/90">{data.shown}</div>
            <div className="text-white/40">cotizaron de nuevo</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            Cambios de visibilidad · {data.pendingVisibility.length}
          </h3>
          {data.pendingVisibility.length === 0 && <p className="text-white/50">Nada esperando confirmación.</p>}
          {data.pendingVisibility.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate font-semibold text-white/90">
                  {v.category ? `${CATEGORY_LABEL[v.category]}: ` : ""}{v.model}{v.capacity ? ` ${v.capacity}` : ""}
                </div>
                <div className="text-white/50">{v.action === "hide" ? "ningún proveedor lo cotizó hoy" : "un proveedor lo volvió a cotizar"}</div>
              </div>
              <button
                type="button"
                className={btn}
                disabled={pendingId === v.id}
                onClick={() => run(v.id, () => applyCatalogVisibility(v.id, v.action))}
              >
                {pendingId === v.id ? "…" : v.action === "hide" ? "Ocultar" : "Habilitar"}
              </button>
            </div>
          ))}
        </div>
      )}

      {data.newModels.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            Modelos nuevos · {data.newModels.length}
          </h3>
          {data.newModels.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate font-semibold text-white/90">
                  {CATEGORY_LABEL[m.category]}: {m.model}{m.capacity ? ` ${m.capacity}` : ""}
                </div>
                <div className="text-white/50">
                  costo US$ {m.detectedCostUsd} de {m.supplierName ?? "proveedor"}
                  {m.suggestedPrice != null && <> · sugerido US$ {m.suggestedPrice} (margen US$ {m.suggestedMargin})</>}
                </div>
              </div>
              <button type="button" className={btn} disabled={pendingId === m.id} onClick={() => run(m.id, () => createCatalogProduct(m.id))}>
                {pendingId === m.id ? "Creando…" : "Crear"}
              </button>
            </div>
          ))}
        </div>
      )}

      {data.newModels.length === 0 && data.auto && (
        <p className="text-white/50">No hay modelos nuevos esperando.</p>
      )}

      {msg && <p className="text-white/50">{msg}</p>}
    </div>
  );
}
