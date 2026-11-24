"use client";

import { useEffect, useState } from "react";
import { loadUsedReference, type UsedReferenceData, type UsedReferenceRow } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

function money(n: number): string {
  return `US$ ${Math.round(n).toLocaleString("es-AR")}`;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

function UsedCard({ r }: { r: UsedReferenceRow }) {
  const title = r.capacity ? `${r.model} · ${r.capacity}` : r.model;
  if (r.minUsd == null) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-2">
        <div className="truncate text-[11px] font-semibold text-white/60">{title}</div>
        <div className="mt-1 text-[11px] text-white/30">sin dato</div>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border bg-white/5 p-2 ${r.stale ? "border-amber-400/30" : "border-white/10"}`}>
      <div className="truncate text-[11px] font-semibold text-white/90">{title}</div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-white/40">Le ofrecés</div>
      <div className="text-base font-bold text-green-400">{money(r.suggestedUsd ?? 0)}</div>
      <div className="mt-1 text-[10px] text-white/50">mín. mayorista {money(r.minUsd)}</div>
      <div className={`text-[10px] ${r.stale ? "text-amber-300" : "text-white/40"}`}>
        {r.supplier} · {r.date ? fmtDate(r.date) : "-"}{r.stale ? " · vieja" : ""}
      </div>
    </div>
  );
}

/**
 * Referencia para cotizar canje de iPhone usado (fase 1, solo para que Nacho la mire): por cada uno
 * de los 15 modelos que compra, el usado más barato que mandó un proveedor y ese precio − US$ 50
 * (la batería). Sin cotización => "sin dato", nunca un número inventado. No le habla a ningún cliente.
 */
export function UsedReferencePanel() {
  const [data, setData] = useState<UsedReferenceData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadUsedReference().then(setData).catch((e) => setErr(String(e))); }, []);

  if (err) return <p className="text-xs text-red-300">{err}</p>;
  if (!data) return <PanelSkeleton />;

  const withData = data.rows.filter((r) => r.minUsd != null).length;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Canje de iPhone usado · referencia</h3>
      <p className="text-[11px] text-white/45">
        Precio de compra = el usado más barato de tus proveedores − US$ {data.discountUsd} (batería). Solo 100% original y batería 85% o más.
        {" "}{withData} de {data.rows.length} (modelo + capacidad) con dato.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {data.rows.map((r) => <UsedCard key={`${r.model}|${r.capacity ?? "na"}`} r={r} />)}
      </div>
    </section>
  );
}
