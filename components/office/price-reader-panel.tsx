"use client";

import { useEffect, useState, useTransition } from "react";
import Markdown from "react-markdown";
import {
  confirmPriceUpdate,
  correctPriceUpdate,
  loadPriceReaderPanel,
  pasteSupplierList,
  saveRules,
  saveSuppliers,
  type PriceReaderPanelData,
} from "@/app/actions";
import type { PriceUpdateRow } from "@/lib/price-review";

const btn = "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";
const input = "w-full rounded-lg border border-white/15 bg-black/50 p-2 text-xs text-white placeholder:text-white/30";

function UpdateRow({ u, onDone }: { u: PriceUpdateRow; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(u.original_price_usd ?? ""));
  const [msg, setMsg] = useState<string | null>(null);
  const label = `${u.model}${u.capacity ? " " + u.capacity : ""}`;
  const reviewed = u.review_status !== "pending";
  return (
    <li className="rounded-lg border border-white/10 bg-white/5 p-2 text-[12px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-white/90">{label}</div>
          <div className="text-white/60">
            Costo US$ {u.review_status === "corrected" ? u.corrected_cost_usd : u.detected_cost_usd}
            {u.original_price_usd != null && u.original_price_usd !== u.detected_cost_usd && ` (publicado ${u.original_price_usd}${u.adjustment_usd ? `, ajuste ${u.adjustment_usd}` : ""})`}
            {u.pricing_basis === "bulk_min" && ` · escalón x${u.bulk_qty ?? "?"}`}
            {u.new_price_usd != null && ` · venta US$ ${u.new_price_usd}`}
          </div>
          {u.raw_line && <div className="mt-0.5 truncate text-white/35" title={u.raw_line}>“{u.raw_line}”</div>}
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            {u.status === "new_model" ? "no está en el catálogo" : u.status === "unchanged" ? "sin cambios" : u.status}
            {reviewed && ` · ${u.review_status === "confirmed" ? "confirmado" : "corregido"}`}
          </div>
        </div>
        {!reviewed && !editing && (
          <div className="flex flex-none gap-1">
            <button className={btn} disabled={pending} onClick={() => start(async () => { await confirmPriceUpdate(u.id); onDone(); })}>OK</button>
            <button className={btn} disabled={pending} onClick={() => setEditing(true)}>Corregir</button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-white/60">Precio unitario correcto US$</span>
          <input className={input + " !w-20"} inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} />
          <button
            className={btn}
            disabled={pending}
            onClick={() => start(async () => {
              const r = await correctPriceUpdate(u.id, Number(val.replace(",", ".")));
              setMsg(r.message);
              if (r.ok) { setEditing(false); onDone(); }
            })}
          >
            {pending ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-white/60">{msg}</p>}
    </li>
  );
}

function SuppliersBox({ data, onDone }: { data: PriceReaderPanelData; onDone: () => void }) {
  const active = data.suppliers.filter((s) => s.active);
  const [text, setText] = useState(active.map((s) => (s.name ? `${s.phone}, ${s.name}` : s.phone)).join("\n"));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300">Proveedores (solo estos se leen)</h3>
      <p className="text-[11px] leading-snug text-white/60">
        Un número por línea, con código de país y sin +: <code>5492257123456, Nombre</code>. Los mensajes de cualquier otro número se ignoran.
      </p>
      <textarea className={input + " h-24 font-mono"} value={text} onChange={(e) => setText(e.target.value)} placeholder="5492257123456, Mayorista Uno" />
      <div className="flex items-center gap-2">
        <button className={btn} disabled={pending} onClick={() => start(async () => { const r = await saveSuppliers(text); setMsg(r.message); onDone(); })}>Guardar</button>
        {msg && <span className="text-xs text-white/60">{msg}</span>}
      </div>
      {active.map((s) => <SupplierRules key={s.id} s={s} />)}
    </section>
  );
}

function SupplierRules({ s }: { s: PriceReaderPanelData["suppliers"][number] }) {
  const rules = s.rules as { unit_discount_usd?: number; notes?: string; examples?: unknown[] };
  const [discount, setDiscount] = useState(rules.unit_discount_usd ? String(rules.unit_discount_usd) : "");
  const [notes, setNotes] = useState(rules.notes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-white/10 p-2 text-[12px]">
      <summary className="cursor-pointer text-white/80">{s.name ?? s.phone} · {s.messages_count} mensajes · {rules.examples?.length ?? 0} correcciones aprendidas</summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-white/60">Descuento por unidad US$
          <input className={input + " !w-16"} inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </label>
        <textarea className={input + " h-14"} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas: cómo publica por cantidad, qué columna es el unitario…" />
        <div className="flex items-center gap-2">
          <button className={btn} disabled={pending} onClick={() => start(async () => { const r = await saveRules(s.id, discount, notes); setMsg(r.message); })}>Guardar reglas</button>
          {msg && <span className="text-white/60">{msg}</span>}
        </div>
      </div>
    </details>
  );
}

function PasteBox({ data, onDone }: { data: PriceReaderPanelData; onDone: () => void }) {
  const [text, setText] = useState("");
  const [supplier, setSupplier] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Pegar lista a mano</h3>
      <textarea className={input + " h-28"} value={text} onChange={(e) => setText(e.target.value)} placeholder={"iPhone 17 Pro Max 256 1250 / 512 1480 x3 1230"} />
      <div className="flex items-center gap-2">
        <select className={input + " !w-auto"} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">Sin proveedor</option>
          {data.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name ?? s.phone}</option>)}
        </select>
        <button className={btn} disabled={pending || text.trim().length < 8} onClick={() => start(async () => { const r = await pasteSupplierList(text, supplier || null); setMsg(r.message); if (r.ok) { setText(""); onDone(); } })}>
          {pending ? "Leyendo… (hasta 1 min)" : "Procesar"}
        </button>
      </div>
      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </section>
  );
}

export function PriceReaderPanel() {
  const [data, setData] = useState<PriceReaderPanelData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => { loadPriceReaderPanel().then(setData).catch((e) => setErr(String(e))); };
  useEffect(() => { reload(); }, []);

  if (err) return <p className="text-xs text-red-300">{err}</p>;
  if (!data) return <p className="text-xs text-white/50">Cargando…</p>;
  const pending = data.updates.filter((u) => u.review_status === "pending" && u.status !== "unchanged");
  return (
    <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
      <SuppliersBox data={data} onDone={reload} />
      <PasteBox data={data} onDone={reload} />
      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">
          Interpretaciones de hoy ({data.updates.length}{pending.length ? ` · ${pending.length} sin revisar` : ""})
        </h3>
        {data.updates.length === 0 ? <p className="text-xs text-white/50">Todavía no llegó nada hoy.</p> : (
          <ul className="flex flex-col gap-2">{data.updates.map((u) => <UpdateRow key={u.id} u={u} onDone={reload} />)}</ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">Último informe{data.report ? ` · ${data.report.date}` : ""}</h3>
        {data.report ? (
          <div className="text-[13px] leading-relaxed text-white/80 [&_a]:text-amber-300 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
            <Markdown>{data.report.markdown}</Markdown>
          </div>
        ) : <p className="text-xs text-white/50">Todavía no hay informes.</p>}
      </section>
    </div>
  );
}
