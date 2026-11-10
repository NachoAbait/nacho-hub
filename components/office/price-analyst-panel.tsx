"use client";

import { useEffect, useState, useTransition } from "react";
import { applyAllRecommended, confirmPriceUpdate, loadPriceComparison, selectSupplierForProduct, type ComparisonRow } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

/** Orden pedido: modelo - chip - (+Cell si tiene) - pulgadas - memoria - RAM, separado con "-". */
function fullLabel(row: ComparisonRow): string {
  const parts = [row.model];
  if (row.chip) parts.push(row.chip);
  if (row.cellular) parts.push("+Cell");
  if (row.inches) parts.push(`${row.inches}"`);
  if (row.capacity) parts.push(row.capacity);
  if (row.ramGb) parts.push(`${row.ramGb}GB RAM`);
  return parts.join(" - ");
}

function money(n: number): string {
  return `US$ ${n.toLocaleString("es-AR")}`;
}

/** GB numérico para ordenar bien: alfabético pone "1TB" antes de "256GB" (compara el "1" contra
 * el "2"), cuando en realidad 1TB es más grande. */
function capacityGb(capacity: string | null): number {
  if (!capacity) return 0;
  const m = capacity.match(/([\d.]+)\s*(GB|TB)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].toUpperCase() === "TB" ? n * 1024 : n;
}

/**
 * Generación + variante de un iPhone ("iPhone 17 Pro Max" -> [17, 4]), para poder ordenar ascendente
 * de verdad: alfabético pone "17 Pro" antes de "17e" (el espacio ordena antes que una letra) y no
 * sabe que "Pro Max" va después de "Pro". Orden de variante: e (el más económico) - base - Air - Pro
 * - Pro Max (el más caro).
 */
function iphoneRank(model: string): [number, number] {
  const m = model.match(/^iphone\s+(\d+)(e)?(?:\s+(air|pro max|pro))?$/i);
  if (!m) return [999, 1];
  const gen = Number(m[1]);
  if (m[2]) return [gen, 0];
  switch ((m[3] ?? "").toLowerCase()) {
    case "air": return [gen, 2];
    case "pro": return [gen, 3];
    case "pro max": return [gen, 4];
    default: return [gen, 1];
  }
}

/**
 * Orden de la lista de Martín: ascendente siempre. iPhone por generación y variante (ver
 * iphoneRank); el resto por modelo y pulgadas. Un +Cell es básicamente otro producto (más caro),
 * así que todas las variantes +Cell de un modelo quedan agrupadas después de las que no lo son,
 * antes de mirar la capacidad — y recién ahí, memoria ascendente.
 */
function compareRows(a: ComparisonRow, b: ComparisonRow): number {
  if (a.category === "iphone") {
    const [genA, varA] = iphoneRank(a.model);
    const [genB, varB] = iphoneRank(b.model);
    if (genA !== genB) return genA - genB;
    if (varA !== varB) return varA - varB;
  } else {
    const modelCmp = a.model.localeCompare(b.model);
    if (modelCmp !== 0) return modelCmp;
    const inchesCmp = (a.inches ?? 0) - (b.inches ?? 0);
    if (inchesCmp !== 0) return inchesCmp;
  }
  if (a.cellular !== b.cellular) return a.cellular ? 1 : -1;
  const capCmp = capacityGb(a.capacity) - capacityGb(b.capacity);
  if (capCmp !== 0) return capCmp;
  if ((a.ramGb ?? 0) !== (b.ramGb ?? 0)) return (a.ramGb ?? 0) - (b.ramGb ?? 0);
  return fullLabel(a).localeCompare(fullLabel(b));
}

/**
 * El cuadro de Martín, vivo adentro del hub: un producto por fila, un proveedor por columna, SOLO
 * con las cotizaciones de hoy (a las 00 arranca vacío otra vez, los precios de ayer no sirven). La
 * celda más barata se ve en verde. La elegida por Martín se ve en ámbar mientras espera tu
 * aprobación: tocarla la confirma. Tocar cualquier otra la reemplaza como elegida y aplica al
 * toque — ni confirmar ni elegir otro dejan un paso intermedio después (como "Corregir" en el panel
 * de Lucas). Una vez aplicada (confirmada o corregida), la celda ganadora queda en verde sólido.
 * Esto reemplaza a la vieja lista "Esperando tu aprobación" del panel de Lucas: las recomendaciones
 * son de Martín, no de Lucas, así que viven acá.
 */
export function PriceAnalystPanel() {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const reload = () => { loadPriceComparison().then(setRows); };
  useEffect(() => { reload(); }, []);

  if (rows === null) return <PanelSkeleton />;
  if (rows.length === 0) {
    return <p className="text-xs text-white/50">Todavía no hay cotizaciones de hoy para comparar. Pegale una lista a Lucas primero.</p>;
  }

  // Los modelos nuevos (sin match en el catálogo) nunca se pueden aplicar desde acá: no hay nada
  // que actualizar hasta que Bruno los crea. No cuentan como "esperando tu aprobación" ni entran
  // en "Aplicar todo lo recomendado", para no prometer un click que no hace nada.
  const pendingCount = rows.filter((r) => r.updateId && r.reviewStatus === "pending" && !r.isNewModel).length;
  const newModelCount = rows.filter((r) => r.isNewModel).length;

  const supplierIds = [...new Set(rows.flatMap((r) => r.quotes.map((q) => q.supplierId)))].sort((a, b) => {
    const an = rows.flatMap((r) => r.quotes).find((q) => q.supplierId === a)?.supplierName ?? a;
    const bn = rows.flatMap((r) => r.quotes).find((q) => q.supplierId === b)?.supplierName ?? b;
    return an.localeCompare(bn);
  });
  const supplierName = (id: string) => rows.flatMap((r) => r.quotes).find((q) => q.supplierId === id)?.supplierName ?? id;

  function run(key: string, action: () => Promise<{ message: string }>) {
    setPendingKey(key);
    start(async () => {
      const r = await action();
      setMsg(r.message);
      setPendingKey(null);
      reload();
    });
  }

  function pick(row: ComparisonRow, supplierId: string) {
    if (!row.updateId) return;
    const quote = row.quotes.find((q) => q.supplierId === supplierId);
    if (!quote) return;
    run(`${row.updateId}:${supplierId}`, () => selectSupplierForProduct(row.updateId!, quote));
  }

  function confirmWinner(row: ComparisonRow) {
    if (!row.updateId) return;
    run(`${row.updateId}:confirm`, () => confirmPriceUpdate(row.updateId!));
  }

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/60">
          {pendingCount > 0 ? `${pendingCount} esperando tu aprobación` : "Nada esperando: todo aplicado"}
          {newModelCount > 0 && ` · ${newModelCount} modelo${newModelCount === 1 ? "" : "s"} nuevo${newModelCount === 1 ? "" : "s"} para crear en Bruno`}
        </span>
        {pendingCount > 0 && (
          <button
            type="button"
            className="rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold text-black transition hover:bg-amber-300 disabled:opacity-50"
            disabled={pendingKey !== null}
            onClick={() => run("apply-all", () => applyAllRecommended())}
          >
            {pendingKey === "apply-all" ? "Aplicando…" : "Aplicar todo lo recomendado"}
          </button>
        )}
      </div>
      {msg && <p className="text-white/50">{msg}</p>}
      {CATEGORY_ORDER.map((category) => {
        const inCategory = rows.filter((r) => r.category === category).sort(compareRows);
        if (!inCategory.length) return null;
        return (
          <div key={category} className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-white/10">
                  <th colSpan={1 + supplierIds.length} className="px-2 py-1 text-left font-semibold uppercase tracking-wider text-white/70">
                    {CATEGORY_LABEL[category]}
                  </th>
                </tr>
                <tr className="text-white/50">
                  <th className="px-2 py-1 text-left font-medium">Producto</th>
                  {supplierIds.map((id) => <th key={id} className="min-w-[72px] px-2 py-1 text-right font-medium">{supplierName(id)}</th>)}
                </tr>
              </thead>
              <tbody>
                {inCategory.map((row) => {
                  const costs = row.quotes.map((q) => q.cost);
                  const cheapest = costs.length ? Math.min(...costs) : null;
                  const applied = row.reviewStatus === "confirmed" || row.reviewStatus === "corrected" || row.reviewStatus === "auto";
                  const isPendingRow = row.reviewStatus === "pending";
                  return (
                    <tr key={fullLabel(row)} className="border-t border-white/5">
                      <td className="px-2 py-1 font-semibold text-white/85">
                        {fullLabel(row)}
                        {row.isNewModel && <span className="ml-1.5 rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">nuevo</span>}
                      </td>
                      {supplierIds.map((id) => {
                        const q = row.quotes.find((x) => x.supplierId === id);
                        if (!q) return <td key={id} className="px-2 py-1 text-right text-white/20">—</td>;
                        const isWinner = row.winnerSupplierId === id;
                        const isCheapest = cheapest != null && q.cost === cheapest;
                        const key = `${row.updateId}:${id}`;
                        const confirmKey = `${row.updateId}:confirm`;
                        const isPendingClick = pendingKey === key || (isWinner && pendingKey === confirmKey);
                        // Modelo nuevo: no hay catálogo que actualizar, así que el "ganador" nunca
                        // se puede confirmar desde acá (por eso se quedaba amarillo para siempre,
                        // por más que lo tocaras). Se marca distinto y manda al panel de Bruno.
                        if (isWinner && row.isNewModel) {
                          return (
                            <td key={id} className="px-1 py-1 text-right">
                              <span title="Modelo nuevo: creálo en el panel de Bruno para poder aplicarle costo" className="block w-full cursor-default rounded border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-right font-bold text-sky-300">
                                {money(q.cost)}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={id} className="px-1 py-1 text-right">
                            <button
                              type="button"
                              disabled={!row.updateId || isPendingClick || (isWinner && applied) || row.isNewModel}
                              title={
                                isWinner && applied ? "Ya aplicado" : isWinner && isPendingRow ? "Tocar para confirmar y aplicar" : "Elegir este proveedor para este producto"
                              }
                              onClick={() => (isWinner ? confirmWinner(row) : pick(row, id))}
                              className={`w-full rounded px-1.5 py-0.5 text-right transition disabled:cursor-default ${
                                isWinner && applied
                                  ? "border border-green-400/60 bg-green-400/25 font-bold text-green-200"
                                  : isWinner
                                    ? "border border-amber-400 bg-amber-400/20 font-bold text-amber-200 hover:bg-amber-400/30"
                                    : isCheapest
                                      ? "bg-green-400/15 text-green-200 hover:bg-green-400/25"
                                      : "text-white/70 hover:bg-white/10"
                              } ${isPendingClick ? "opacity-40" : ""}`}
                            >
                              {money(q.cost)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
