"use client";

import { useEffect, useState, useTransition } from "react";
import { loadPriceComparison, selectSupplierForProduct, type ComparisonRow } from "@/app/actions";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

function fullLabel(row: ComparisonRow): string {
  const parts = [row.model];
  if (row.chip) parts.push(row.chip);
  if (row.capacity) parts.push(row.capacity);
  if (row.ramGb) parts.push(`${row.ramGb}GB RAM`);
  return parts.join(" ");
}

function money(n: number): string {
  return `US$ ${n.toLocaleString("es-AR")}`;
}

/**
 * El cuadro de Martín, vivo adentro del hub: un producto por fila, un proveedor por columna, SOLO
 * con las cotizaciones de hoy (a las 00 arranca vacío otra vez, los precios de ayer no sirven). La
 * celda más barata se ve en verde; tocar cualquier otra la elige a mano en su lugar y aplica al
 * toque, igual que "Corregir" en el panel de Lucas — no es un archivo, no hay paso intermedio.
 */
export function PriceAnalystPanel() {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const reload = () => { loadPriceComparison().then(setRows); };
  useEffect(() => { reload(); }, []);

  if (rows === null) return <p className="text-xs text-white/50">Cargando…</p>;
  if (rows.length === 0) {
    return <p className="text-xs text-white/50">Todavía no hay cotizaciones de hoy para comparar. Pegale una lista a Lucas primero.</p>;
  }

  const supplierIds = [...new Set(rows.flatMap((r) => r.quotes.map((q) => q.supplierId)))].sort((a, b) => {
    const an = rows.flatMap((r) => r.quotes).find((q) => q.supplierId === a)?.supplierName ?? a;
    const bn = rows.flatMap((r) => r.quotes).find((q) => q.supplierId === b)?.supplierName ?? b;
    return an.localeCompare(bn);
  });
  const supplierName = (id: string) => rows.flatMap((r) => r.quotes).find((q) => q.supplierId === id)?.supplierName ?? id;

  function pick(row: ComparisonRow, supplierId: string) {
    if (!row.updateId) return;
    const quote = row.quotes.find((q) => q.supplierId === supplierId);
    if (!quote) return;
    const key = `${row.updateId}:${supplierId}`;
    setPendingKey(key);
    start(async () => {
      const r = await selectSupplierForProduct(row.updateId!, quote);
      setMsg(r.message);
      setPendingKey(null);
      reload();
    });
  }

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      {msg && <p className="text-white/50">{msg}</p>}
      {CATEGORY_ORDER.map((category) => {
        const inCategory = rows.filter((r) => r.category === category).sort((a, b) => fullLabel(a).localeCompare(fullLabel(b)));
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
                  return (
                    <tr key={fullLabel(row)} className="border-t border-white/5">
                      <td className="px-2 py-1 font-semibold text-white/85">{fullLabel(row)}</td>
                      {supplierIds.map((id) => {
                        const q = row.quotes.find((x) => x.supplierId === id);
                        if (!q) return <td key={id} className="px-2 py-1 text-right text-white/20">—</td>;
                        const isWinner = row.winnerSupplierId === id;
                        const isCheapest = cheapest != null && q.cost === cheapest;
                        const key = `${row.updateId}:${id}`;
                        return (
                          <td key={id} className="px-1 py-1 text-right">
                            <button
                              type="button"
                              disabled={!row.updateId || isWinner || pendingKey === key}
                              title={isWinner ? "Es el elegido" : "Elegir este proveedor para este producto"}
                              onClick={() => pick(row, id)}
                              className={`w-full rounded px-1.5 py-0.5 text-right transition disabled:cursor-default ${
                                isWinner
                                  ? "border border-amber-400 bg-amber-400/20 font-bold text-amber-200"
                                  : isCheapest
                                    ? "bg-green-400/15 text-green-200 hover:bg-green-400/25"
                                    : "text-white/70 hover:bg-white/10"
                              } ${pendingKey === key ? "opacity-40" : ""}`}
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
