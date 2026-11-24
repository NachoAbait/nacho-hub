"use client";

import { useMemo, useState, useEffect } from "react";
import { loadUsedReference, type UsedReferenceData, type UsedReferenceRow } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";
import {
  BATTERY_TIERS, AESTHETIC_GRADES, AESTHETIC_EXTRA_USD, suggestedForCondition, type AestheticGrade,
} from "@/lib/used-quotes";

function money(n: number): string {
  return `US$ ${Math.round(n).toLocaleString("es-AR")}`;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

/** Grupo de botones chiquito para elegir una franja (batería o estado). Mismo patrón para las dos,
 * para que el panel entero se lea como un solo simulador: cambiás acá arriba y recalcula todo abajo. */
function PillGroup<T extends string>({ value, options, labels, onChange }: {
  value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
            opt === value
              ? "border-amber-400/60 bg-amber-400/15 text-amber-300"
              : "border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.07]"
          }`}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function UsedCard({ r, batteryPct, grade }: { r: UsedReferenceRow; batteryPct: number; grade: AestheticGrade }) {
  const title = r.capacity ? `${r.model} · ${r.capacity}` : r.model;
  if (r.minUsd == null) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-2">
        <div className="truncate text-[11px] font-semibold text-white/60">{title}</div>
        <div className="mt-1 text-[11px] text-white/30">sin dato</div>
      </div>
    );
  }
  const suggested = suggestedForCondition(r.minUsd, batteryPct, grade);
  return (
    <div className={`rounded-lg border bg-white/5 p-2 ${r.stale ? "border-amber-400/30" : "border-white/10"}`}>
      <div className="truncate text-[11px] font-semibold text-white/90">{title}</div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-white/40">Le ofrecés</div>
      <div className="text-base font-bold text-green-400">{suggested != null ? money(suggested) : "—"}</div>
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
  const [batteryLabel, setBatteryLabel] = useState<(typeof BATTERY_TIERS)[number]["label"]>(BATTERY_TIERS[0].label);
  const [grade, setGrade] = useState<AestheticGrade>("A+");
  useEffect(() => { loadUsedReference().then(setData).catch((e) => setErr(String(e))); }, []);

  const batteryTier = BATTERY_TIERS.find((t) => t.label === batteryLabel) ?? BATTERY_TIERS[0];
  const batteryLabels = useMemo(
    () => Object.fromEntries(BATTERY_TIERS.map((t) => [t.label, t.label])) as Record<string, string>,
    [],
  );
  const gradeLabels = useMemo(
    () => Object.fromEntries(AESTHETIC_GRADES.map((g) => [g, g])) as Record<AestheticGrade, string>,
    [],
  );

  if (err) return <p className="text-xs text-red-300">{err}</p>;
  if (!data) return <PanelSkeleton />;

  const withData = data.rows.filter((r) => r.minUsd != null).length;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Canje de iPhone usado · referencia</h3>
      <p className="text-[11px] text-white/45">
        Precio de compra = el usado más barato de tus proveedores − US$ {data.discountUsd} (base, equipo A+ y batería 90–100%)
        {" "}− extra según la batería y el estado real que te traiga el cliente. Solo 100% original y batería 85% o más.
        {" "}{withData} de {data.rows.length} (modelo + capacidad) con dato.
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-white/40">Batería real</span>
          <PillGroup
            value={batteryLabel}
            options={BATTERY_TIERS.map((t) => t.label)}
            labels={batteryLabels}
            onChange={setBatteryLabel}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-white/40">Estado estético</span>
          <PillGroup value={grade} options={AESTHETIC_GRADES} labels={gradeLabels} onChange={setGrade} />
        </div>
        <span className="ml-auto text-[10px] text-white/35">
          Extra con esta combinación: −US$ {batteryTier.extraUsd} batería · −US$ {AESTHETIC_EXTRA_USD[grade]} estado
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {data.rows.map((r) => (
          <UsedCard key={`${r.model}|${r.capacity ?? "na"}`} r={r} batteryPct={batteryTier.min} grade={grade} />
        ))}
      </div>
    </section>
  );
}
