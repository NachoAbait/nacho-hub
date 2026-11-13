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
import type { PendingNewModel, PendingVisibility } from "@/lib/agents/catalog-manager";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

const btn = "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";

function money(n: number): string {
  return `US$ ${n.toLocaleString("es-AR")}`;
}

function label(model: string, capacity: string | null): string {
  return capacity ? `${model} ${capacity}` : model;
}

/** Feedback de "está cargando" más visible que un simple "…": sin esto, con la red un poco lenta
 * parecía que el click no hizo nada y el usuario volvía a tocar el botón. */
function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

/** Modelos nuevos: a diferencia de PendingVisibility (ya viene armado con catalogModelText), acá
 * model queda limpio a propósito (ver price-analyst.ts) y chip/+Cell/pulgadas/mm viven aparte —
 * sin esto el cartel no distinguía un Apple Watch de 46mm de uno de 42mm. */
function newModelLabel(m: PendingNewModel): string {
  const detail = [m.chip, m.cellular ? "+Cell" : null, m.inches ? `${m.inches}"` : null, m.screenMm ? `${m.screenMm}mm` : null].filter(Boolean).join(" ");
  return label([m.model, detail].filter(Boolean).join(" "), m.capacity);
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
 * al final. Confirmar un ítem no lo hace desaparecer: se queda en el mismo lugar, pasa a verde y
 * pierde el botón — y eso se guarda del lado del servidor (lo que confirmaste HOY), no solo en la
 * pestaña abierta: cerrar y volver a abrir el panel no lo hace desaparecer.
 */
export function CatalogManagerPanel() {
  const [data, setData] = useState<CatalogManagerData | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Visibilidad no tiene un registro propio en la base (solo toca NexiOS directo), así que acá sí
  // se pierde al cerrar el panel — a diferencia de Habilitar/Crear, que el servidor recuerda.
  const [doneVisibility, setDoneVisibility] = useState<Map<string, { title: string; subtitle: string }>>(new Map());
  // Al confirmar algo, en vez de refrescar al toque (lo que hacía que el ítem desapareciera de
  // golpe y pareciera que el click no sirvió de nada), lo dejamos marcado "listo" un instante para
  // que se vea el flash verde, y recién ahí pedimos los datos nuevos.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  const reload = () => { loadCatalogManagerPanel().then(setData); };
  useEffect(() => { reload(); }, []);

  if (data === undefined) return <PanelSkeleton />;

  function run(key: string, action: () => Promise<{ ok: boolean; message: string }>, done?: { title: string; subtitle: string }) {
    setPendingId(key);
    start(async () => {
      const r = await action();
      setMsg(r.message);
      setPendingId(null);
      if (!r.ok) {
        reload();
        return;
      }
      setJustDone((prev) => new Set(prev).add(key));
      if (done) setDoneVisibility((prev) => new Map(prev).set(key, done));
      setTimeout(() => {
        setJustDone((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        reload();
      }, 650);
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
          {pendingId === "auto-toggle" ? <Spinner /> : data.auto ? "Pasar a manual" : "Pasar a automático"}
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
              {priced.map((p) => {
                const isPending = pendingId === p.id;
                const isDone = p.confirmed || justDone.has(p.id);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 transition-colors duration-300">
                    <div className="min-w-0">
                      <div className={`truncate font-semibold transition-colors duration-300 ${isDone ? "text-green-400" : "text-white/90"}`}>{label(p.model, p.capacity)}</div>
                      <div className={`transition-colors duration-300 ${isDone ? "text-green-400/60" : "text-white/50"}`}>
                        {p.previousCost != null ? `${money(p.previousCost)} en la app → ` : "sin precio previo → "}
                        <span className={`font-semibold ${isDone ? "text-green-400" : "text-amber-300"}`}>{money(p.newCost)}</span>
                        {p.supplierName ? ` · ${p.supplierName}` : ""}
                      </div>
                    </div>
                    {isDone ? (
                      <span className="text-sm text-green-400">✓</span>
                    ) : (
                      <button
                        type="button"
                        className={btn}
                        disabled={isPending}
                        onClick={() => run(p.id, () => confirmPriceUpdate(p.id))}
                      >
                        {isPending ? <Spinner /> : "Habilitar"}
                      </button>
                    )}
                  </div>
                );
              })}
              {fresh.map((m) => {
                const isPending = pendingId === m.id;
                const isDone = m.confirmed || justDone.has(m.id);
                return (
                  <div key={m.id} className={`flex items-center justify-between gap-2 px-2 py-1.5 transition-colors duration-300 ${isDone ? "" : "border-sky-400/30 bg-sky-400/10"}`}>
                    <div className="min-w-0">
                      <div className={`truncate font-semibold transition-colors duration-300 ${isDone ? "text-green-400" : "text-sky-200"}`}>
                        {newModelLabel(m)}{" "}
                        <span className={`ml-1 text-[9px] font-bold uppercase tracking-wide ${isDone ? "text-green-400" : "text-sky-300"}`}>
                          {isDone ? "creado" : "nuevo"}
                        </span>
                      </div>
                      <div className={`transition-colors duration-300 ${isDone ? "text-green-400/60" : "text-sky-200/60"}`}>
                        costo {money(m.detectedCostUsd)} de {m.supplierName ?? "proveedor"}
                        {m.suggestedPrice != null && <> · sugerido {money(m.suggestedPrice)} (margen {money(m.suggestedMargin!)})</>}
                      </div>
                    </div>
                    {isDone ? (
                      <span className="text-sm text-green-400">✓</span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-full border border-sky-400/40 bg-sky-400/15 px-3 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-400/25 disabled:opacity-40"
                        disabled={isPending}
                        onClick={() => run(m.id, () => createCatalogProduct(m.id))}
                      >
                        {isPending ? <Spinner /> : "Crear"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* En automático van los conteos, salvo que el freno haya dejado cambios esperando: ahí
          manda la lista para confirmarlos, que es lo único que desbloquea el catálogo. */}
      {data.auto && data.pendingVisibility.length === 0 && doneVisibility.size === 0 ? (
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
          {data.pendingVisibility.length === 0 && doneVisibility.size === 0 && <p className="text-white/50">Nada esperando confirmación.</p>}
          {data.pendingVisibility.map((v: PendingVisibility) => {
            const isShow = v.action === "show";
            const isPending = pendingId === v.id;
            const isDone = justDone.has(v.id);
            return (
              <div
                key={v.id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition-all duration-300 ${
                  isDone
                    ? "scale-[0.99] border-green-400/40 bg-green-400/15 opacity-90"
                    : isShow
                      ? "border-green-400/25 bg-green-400/5"
                      : "border-amber-400/25 bg-amber-400/5"
                }`}
              >
                {isDone ? (
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-green-300">Listo</div>
                    <div className="mt-0.5 truncate font-semibold text-green-200">
                      {v.category ? `${CATEGORY_LABEL[v.category]}: ` : ""}{v.model}{v.capacity ? ` ${v.capacity}` : ""}
                    </div>
                    <div className="text-green-300/60">{isShow ? "mostrado en la tienda" : "ocultado de la tienda"}</div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className={`text-[9px] font-bold uppercase tracking-wide ${isShow ? "text-green-300" : "text-amber-300"}`}>
                      {isShow ? "Volvió a tener stock" : "Sin stock"}
                    </div>
                    <div className="mt-0.5 truncate font-semibold text-white/90">
                      {v.category ? `${CATEGORY_LABEL[v.category]}: ` : ""}{v.model}{v.capacity ? ` ${v.capacity}` : ""}
                    </div>
                    <div className="text-white/50">
                      {isShow
                        ? `No estaba disponible y hoy ${v.supplierName ?? "un proveedor"} lo cotizó${v.cost != null ? ` a ${money(v.cost)}` : ""}.`
                        : "Hace días que ningún proveedor lo cotiza: parece que no hay stock."}
                    </div>
                  </div>
                )}
                {isDone ? (
                  <span className="text-base text-green-400">✓</span>
                ) : (
                  <button
                    type="button"
                    className={
                      isShow
                        ? "rounded-full border border-green-400/40 bg-green-400/15 px-3 py-1 text-xs font-semibold text-green-200 transition hover:bg-green-400/25 disabled:opacity-40"
                        : "rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-40"
                    }
                    disabled={isPending}
                    onClick={() => run(
                      v.id,
                      () => applyCatalogVisibility(v.id, v.action),
                      {
                        title: `${v.category ? `${CATEGORY_LABEL[v.category]}: ` : ""}${v.model}${v.capacity ? ` ${v.capacity}` : ""}`,
                        subtitle: isShow ? "vuelto a mostrar" : "ocultado",
                      },
                    )}
                  >
                    {isPending ? <Spinner /> : isShow ? "Mostrar en la tienda" : "Ocultar de la tienda"}
                  </button>
                )}
              </div>
            );
          })}
          {[...doneVisibility.values()].map((d) => (
            <div key={d.title} className="flex items-center justify-between gap-2 px-1 py-0.5">
              <div className="min-w-0">
                <div className="truncate font-semibold text-green-400">{d.title}</div>
                <div className="text-green-400/60">{d.subtitle}</div>
              </div>
              <span className="text-sm text-green-400">✓</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
