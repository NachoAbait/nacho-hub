"use client";

import { useEffect, useState } from "react";
import { loadStockReport, type StockReport } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

function money(n: number): string {
  return `US$ ${Math.round(n).toLocaleString("es-AR")}`;
}

function productLabel(r: StockReport["rows"][number]): string {
  return `${r.deviceType} ${r.model}${r.capacity ? ` ${r.capacity}` : ""}`;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "border-green-400/30 bg-green-400/10 text-green-200" : tone === "bad" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-white/15 bg-white/5 text-white/85";
  return (
    <div className={`flex-1 rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[9px] uppercase tracking-[0.2em] opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold">{value}</div>
    </div>
  );
}

function RowTable({ rows, extra }: { rows: StockReport["rows"]; extra: (r: StockReport["rows"][number]) => string }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.deviceType}-${r.model}-${r.capacity}`} className="border-t border-white/5">
            <td className="py-1 pr-2 font-semibold text-white/85">{productLabel(r)}</td>
            <td className="py-1 text-right text-white/60">{extra(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * El cuadro de Julieta, visual en vez de texto: tarjetas con los números clave arriba, y abajo los
 * modelos agrupados por qué necesitan (sin rotar, envejecidos, se agotan), igual que los grupos por
 * categoría del cuadro de Martín. Siempre en vivo contra NexiOS, no espera a que corra el agente.
 */
export function StockAnalystPanel() {
  const [report, setReport] = useState<StockReport | null>(null);

  useEffect(() => { loadStockReport().then(setReport); }, []);

  if (report === null) return <PanelSkeleton />;
  if (!report.available) return <p className="text-xs text-white/50">No tengo acceso a NexiOS ahora mismo.</p>;

  const dead = report.rows.filter((r) => r.units > 0 && r.soldUnits === 0 && r.agingDays > 30).sort((a, b) => b.costUsd - a.costUsd);
  const deadKeys = new Set(dead.map((r) => `${r.deviceType}-${r.model}-${r.capacity}`));
  const aging60 = report.rows
    .filter((r) => r.units > 0 && r.agingDays > 60 && !deadKeys.has(`${r.deviceType}-${r.model}-${r.capacity}`))
    .sort((a, b) => b.agingDays - a.agingDays);
  const fastMovers = report.rows.filter((r) => r.sellThrough != null && r.sellThrough > 0.7 && r.units <= 2).sort((a, b) => (b.sellThrough ?? 0) - (a.sellThrough ?? 0));
  const rest = report.rows
    .filter((r) => !deadKeys.has(`${r.deviceType}-${r.model}-${r.capacity}`) && !fastMovers.includes(r) && !aging60.includes(r))
    .sort((a, b) => b.costUsd - a.costUsd);

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <div className="flex gap-2">
        <StatCard label="Caja neta 30d" value={money(report.netCash)} tone={report.netCash >= 0 ? "good" : "bad"} />
        <StatCard label="Capital en stock" value={money(report.capitalTiedUp)} tone="neutral" />
        <StatCard label="Unidades" value={String(report.unitsInStock)} tone="neutral" />
        <StatCard label="Ventas 30d" value={String(report.salesCount)} tone="neutral" />
      </div>

      {dead.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-red-400/25">
          <div className="bg-red-400/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">
            🔴 Sin rotar hace 30+ días ({dead.length})
          </div>
          <div className="p-2">
            <RowTable rows={dead} extra={(r) => `${r.units}u · ${money(r.costUsd)} · ${r.agingDays}d`} />
          </div>
        </div>
      )}

      {aging60.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-amber-400/25">
          <div className="bg-amber-400/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            🟠 Más de 60 días en stock ({aging60.length})
          </div>
          <div className="p-2">
            <RowTable rows={aging60} extra={(r) => `${r.units}u · ${r.agingDays}d · ${r.soldUnits} vendidas`} />
          </div>
        </div>
      )}

      {fastMovers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-green-400/25">
          <div className="bg-green-400/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-300">
            🟢 Se agotan rápido ({fastMovers.length})
          </div>
          <div className="p-2">
            <RowTable rows={fastMovers} extra={(r) => `quedan ${r.units}u · ${Math.round((r.sellThrough ?? 0) * 100)}% sell-through`} />
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <details className="rounded-lg border border-white/10 p-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">Ver el resto ({rest.length})</summary>
          <div className="mt-2">
            <RowTable rows={rest} extra={(r) => `${r.units}u · ${money(r.costUsd)} · ${r.soldUnits} vendidas 30d`} />
          </div>
        </details>
      )}
    </div>
  );
}
