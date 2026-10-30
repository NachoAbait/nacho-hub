"use client";

import { useState, useEffect } from "react";
import { loadCaptionSets, type CaptionSetData, type CaptionVariant } from "@/app/actions";
import type { BusinessContext } from "@/lib/types";

function VariantCard({ v }: { v: CaptionVariant }) {
  const [copied, setCopied] = useState(false);
  const full = `${v.text}\n\n${v.hashtags.map((h) => `#${h}`).join(" ")}`;
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/40">{v.label}</span>
        <button
          type="button"
          className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/70 transition hover:bg-white/10"
          onClick={() => { navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        >
          {copied ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
      <p className="whitespace-pre-line text-white/85">{v.text}</p>
      {v.hashtags.length > 0 && <p className="mt-1 text-sky-300/80">{v.hashtags.map((h) => `#${h}`).join(" ")}</p>}
    </div>
  );
}

function CaptionSetCard({ set }: { set: CaptionSetData }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 p-2">
      <div className="font-semibold text-white/90">{set.title}</div>
      <div className="flex flex-col gap-1.5">
        {set.variants.map((v, i) => <VariantCard key={i} v={v} />)}
      </div>
    </div>
  );
}

/** Los captions de Facundo, una tarjeta copiable por variante en vez de texto corrido. */
export function CopyWriterPanel({ context }: { context: BusinessContext }) {
  const [loaded, setLoaded] = useState<{ context: BusinessContext; value: { date: string; sets: CaptionSetData[] } | null } | null>(null);
  useEffect(() => { loadCaptionSets(context).then((value) => setLoaded({ context, value })); }, [context]);
  const data = loaded?.context === context ? loaded.value : undefined;

  if (data === undefined) return <p className="text-xs text-white/50">Cargando…</p>;
  if (!data || data.sets.length === 0) return <p className="text-xs text-white/50">Todavía no hay captions para hoy.</p>;

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {data.sets.map((set, i) => <CaptionSetCard key={i} set={set} />)}
    </div>
  );
}
