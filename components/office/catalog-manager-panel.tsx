"use client";

import { useEffect, useState, useTransition } from "react";
import {
  applyCatalogVisibility,
  confirmPriceUpdate,
  createCatalogProduct,
  loadCatalogManagerPanel,
  setCatalogManagerAuto,
  type CatalogManagerData,
  type PendingPriceUpdate,
} from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import type { PendingNewModel } from "@/lib/agents/catalog-manager";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

const btn = "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";

function money(n: number): string {
  return `US$ ${n.toLocaleString("es-AR")}`;
}

function label(model: string, capacity: string | null): string {
  return capacity ? `${model} ${capacity}` : model;
}

/** Agrupa por categoría y las ordena según CATEGORY_ORDER, como hace el panel de Martín. */
function byCategory<T extends { category: Category }>(items: T[]): [Category, T[]][] {
  const map = new Map<Category, T[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return CATEGORY_ORDER.map((c) => [c, map.get(c) ?? []] as [Category, T[]]).filter(([, list]) => list.length > 0);
}

/**
 * El panel de Bruno, con el mismo formato que el de Martín: separado por categoría. Primero, para
 * cada categoría, los productos YA creados con precio nuevo esperando confirmación (precio en la
 * app → precio nuevo, botón Habilitar). Después, en celeste, los que todavía no están cargados en
 * la app (botón Crear). Los cambios de visibilidad (ocultar/mostrar por falta de stock) van aparte,
 * al final, porque es una decisión distinta a cambiar o crear un precio.
 */
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

  const priceGroups = byCategory(data.pendingPriceUpdates);
  const newGroups = byCategory(data.newModels);
  const categoriesWithStuff = CATEGORY_ORDER.filter(
    (c) => priceGroups.some(([cat]) => cat === c) || newGroups.some(([cat]) => cat === c),
  );

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

      {msg && <p className="text-white/50">{msg}</p>}

      {categoriesWithStuff.length === 0 && (
        <p className="text-white/50">Nada esperando: ni precios para actualizar ni modelos nuevos.</p>
      )}

      {categoriesWithStuff.map((category) => {
        const priced: PendingPriceUpdate[] = priceGroups.find(([c]) => c === category)?.[1] ?? [];
        const fresh: PendingNewModel[] = newGroups.find(([c]) => c === category)?.[1] ?? [];
        return (
          <div key={category} className="overflow-hidden rounded-lg border border-white/10">
            <div className="bg-white/10 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-white/70">
              {CATEGORY_LABEL[category]}
            </div>
            <div className="flex flex-col divide-y divide-white/5">
              {priced.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white/90">{label(p.model, p.capacity)}</div>
                    <div className="text-white/50">
                      {p.previousCost != null ? `${money(p.previousCost)} en la app → ` : "sin precio previo → "}
                      <span className="font-semibold text-amber-300">{money(p.newCost)}</span>
                      {p.supplierName ? ` · ${p.supplierName}` : ""}
                    </div>
                  </div>
                  <button type="button" className={btn} disabled={pendingId === p.id} onClick={() => run(p.id, () => confirmPriceUpdate(p.id))}>
                    {pendingId === p.id ? "…" : "Habilitar"}
                  </button>
                </div>
              ))}
              {fresh.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 border-sky-400/30 bg-sky-400/10 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-sky-200">{label(m.model, m.capacity)} <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-sky-300">nuevo</span></div>
                    <div className="text-sky-200/60">
                      costo {money(m.detectedCostUsd)} de {m.supplierName ?? "proveedor"}
                      {m.suggestedPrice != null && <> · sugerido {money(m.suggestedPrice)} (margen {money(m.suggestedMargin!)})</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-sky-400/40 bg-sky-400/15 px-3 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-400/25 disabled:opacity-40"
                    disabled={pendingId === m.id}
                    onClick={() => run(m.id, () => createCatalogProduct(m.id))}
                  >
                    {pendingId === m.id ? "Creando…" : "Crear"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

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
    </div>
  );
}
