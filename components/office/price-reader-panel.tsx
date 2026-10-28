"use client";

import { useEffect, useState, useTransition } from "react";
import Markdown from "react-markdown";
import {
  addSupplier,
  approveSender,
  confirmPriceUpdate,
  correctPriceUpdate,
  dismissSender,
  loadPriceReaderPanel,
  pasteSupplierList,
  removeSupplier,
  saveRules,
  saveSuppliers,
  type PriceReaderPanelData,
} from "@/app/actions";
import type { PriceUpdateRow } from "@/lib/price-review";

const btn = "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";
const input = "w-full rounded-lg border border-white/15 bg-black/50 p-2 text-xs text-white placeholder:text-white/30";

const REVIEW_LABEL: Record<PriceUpdateRow["review_status"], string> = {
  pending: "sin revisar",
  auto: "aplicado automático",
  confirmed: "confirmado",
  corrected: "corregido",
};

function UpdateRow({ u, onDone }: { u: PriceUpdateRow; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(u.original_price_usd ?? ""));
  const [msg, setMsg] = useState<string | null>(null);
  const label = `${u.model}${u.capacity ? " " + u.capacity : ""}`;
  // Confirmado o corregido por Nacho: ya no hay nada para hacer acá.
  const humanActed = u.review_status === "confirmed" || u.review_status === "corrected";
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
            {" · "}{REVIEW_LABEL[u.review_status]}
          </div>
        </div>
        {!humanActed && !editing && (
          <div className="flex flex-none gap-1">
            {/* OK solo tiene sentido en lo que de verdad está sin revisar; lo aplicado solo ya quedó hecho. */}
            {u.review_status === "pending" && (
              <button className={btn} disabled={pending} onClick={() => start(async () => { await confirmPriceUpdate(u.id); onDone(); })}>OK</button>
            )}
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

function PendingSendersBox({ data, onDone }: { data: PriceReaderPanelData; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [names, setNames] = useState<Record<string, string>>({});
  if (data.pendingSenders.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-sky-400/30 bg-sky-400/5 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-300">
        Remitentes nuevos ({data.pendingSenders.length})
      </h3>
      <p className="text-[11px] leading-snug text-white/60">
        Llegaron mensajes de estos números o canales, pero todavía no están sumados: no se leyeron precios.
        Sumalo si es un proveedor, o descartalo si es una consulta de cliente.
      </p>
      <ul className="flex flex-col gap-2">
        {data.pendingSenders.map((p) => (
          <li key={p.sender} className="rounded-lg border border-white/10 bg-black/30 p-2 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/60">
                {p.kind === "channel" ? "canal" : "número"}
              </span>
              <span className="truncate font-mono text-white/80">{p.sender_name ? `${p.sender_name} · ` : ""}{p.sender}</span>
              <span className="ml-auto flex-none text-white/40">{p.messages_count} msj</span>
            </div>
            {p.last_body && <div className="mt-1 truncate text-white/35" title={p.last_body}>“{p.last_body}”</div>}
            <div className="mt-2 flex items-center gap-2">
              <input
                className={input + " !w-40"}
                placeholder="Nombre del proveedor"
                value={names[p.sender] ?? p.sender_name ?? ""}
                onChange={(e) => setNames((n) => ({ ...n, [p.sender]: e.target.value }))}
              />
              <button
                className={btn}
                disabled={pending}
                onClick={() => start(async () => { await approveSender(p.sender, names[p.sender] ?? p.sender_name ?? null); onDone(); })}
              >
                Sumar como proveedor
              </button>
              <button
                className={btn}
                disabled={pending}
                onClick={() => start(async () => { await dismissSender(p.sender); onDone(); })}
              >
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Alta de un proveedor por vez: no toca a los demás. Es la forma normal de sumar. */
function AddSupplierForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  function submit() {
    start(async () => {
      const r = await addSupplier(phone, name);
      setMsg(r.message);
      if (r.ok) { setPhone(""); setName(""); onDone(); }
    });
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        className={input + " sm:w-44"}
        inputMode="numeric"
        placeholder="5492257123456"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && phone.trim() && submit()}
      />
      <input
        className={input + " sm:w-40"}
        placeholder="Nombre (opcional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && phone.trim() && submit()}
      />
      <button className={btn} disabled={pending || !phone.trim()} onClick={submit}>
        {pending ? "Sumando…" : "+ Agregar proveedor"}
      </button>
      {msg && <span className="text-xs text-white/60">{msg}</span>}
    </div>
  );
}

function SuppliersBox({ data, onDone }: { data: PriceReaderPanelData; onDone: () => void }) {
  const active = data.suppliers.filter((s) => s.active);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300">Proveedores (solo estos se leen)</h3>
      <p className="text-[11px] leading-snug text-white/60">
        Número con código de país, sin +. Los canales de difusión no se pueden cargar acá de antemano (WhatsApp no te da
        su código hasta que llega el primer mensaje): cuando llegue uno nuevo lo vas a ver abajo, en &quot;Remitentes
        nuevos&quot;, para sumarlo con un toque.
      </p>
      <AddSupplierForm onDone={onDone} />
      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((s) => <SupplierRules key={s.id} s={s} onDone={onDone} />)}
        </ul>
      )}
      <ReplaceAllBox active={active} onDone={onDone} />
    </section>
  );
}

function SupplierRules({ s, onDone }: { s: PriceReaderPanelData["suppliers"][number]; onDone: () => void }) {
  const rules = s.rules as { unit_discount_usd?: number; notes?: string; examples?: unknown[] };
  const [discount, setDiscount] = useState(rules.unit_discount_usd ? String(rules.unit_discount_usd) : "");
  const [notes, setNotes] = useState(rules.notes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <li>
      <details className="rounded-lg border border-white/10 p-2 text-[12px]">
        <summary className="flex cursor-pointer items-center gap-2 text-white/80">
          <span className="flex-1">{s.name ?? s.phone} · {s.messages_count} mensajes · {rules.examples?.length ?? 0} correcciones aprendidas</span>
          <button
            type="button"
            className="flex-none rounded-full px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/10 hover:text-red-300"
            disabled={pending}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); start(async () => { await removeSupplier(s.id); onDone(); }); }}
          >
            Quitar
          </button>
        </summary>
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
    </li>
  );
}

/** Reemplazo total de la lista, colapsado por default: es destructivo (da de baja a quien no esté en el texto). */
function ReplaceAllBox({ active, onDone }: { active: PriceReaderPanelData["suppliers"]; onDone: () => void }) {
  const [text, setText] = useState(active.map((s) => (s.name ? `${s.phone}, ${s.name}` : s.phone)).join("\n"));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-white/10 p-2 text-[11px]">
      <summary className="cursor-pointer text-white/50">Reemplazar toda la lista de una vez (avanzado)</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-white/50">
          Pegá acá la lista completa de proveedores activos, uno por línea. Ojo: a quien no esté en este texto se lo da de baja.
          Para sumar uno solo, usá el botón de arriba.
        </p>
        <textarea className={input + " h-24 font-mono"} value={text} onChange={(e) => setText(e.target.value)} placeholder="5492257123456, Mayorista Uno" />
        <div className="flex items-center gap-2">
          <button className={btn} disabled={pending} onClick={() => start(async () => { const r = await saveSuppliers(text); setMsg(r.message); onDone(); })}>Reemplazar lista</button>
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
  // El Price Reader ya aplicó todo solo; esto es sin revisar = de verdad necesita tu ojo
  // (baja confianza, salto de precio grande, precio inferido por cantidad, o un modelo nuevo).
  const needsReview = data.updates.filter((u) => u.review_status === "pending" && u.status !== "unchanged");
  const rest = data.updates.filter((u) => !(u.review_status === "pending" && u.status !== "unchanged"));
  return (
    <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
      <PendingSendersBox data={data} onDone={reload} />
      <SuppliersBox data={data} onDone={reload} />
      <PasteBox data={data} onDone={reload} />
      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/45">
          {needsReview.length > 0 ? `Pide tu revisión (${needsReview.length})` : "Interpretaciones de hoy"}
        </h3>
        {data.updates.length === 0 ? (
          <p className="text-xs text-white/50">Todavía no llegó nada hoy.</p>
        ) : needsReview.length === 0 ? (
          <p className="text-xs text-white/50">Nada para revisar: todo lo que llegó hoy se aplicó solo.</p>
        ) : (
          <ul className="flex flex-col gap-2">{needsReview.map((u) => <UpdateRow key={u.id} u={u} onDone={reload} />)}</ul>
        )}
        {rest.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-white/40">Ver el resto ({rest.length}, ya aplicado o sin cambios)</summary>
            <ul className="mt-2 flex flex-col gap-2">{rest.map((u) => <UpdateRow key={u.id} u={u} onDone={reload} />)}</ul>
          </details>
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
