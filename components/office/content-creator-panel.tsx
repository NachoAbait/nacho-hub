"use client";

import { useEffect, useState } from "react";
import { loadContentIdeas, type ContentIdea } from "@/app/actions";
import type { BusinessContext } from "@/lib/types";

const FORMAT_COLOR = "border-sky-400/25 bg-sky-400/5";

function IdeaCard({ idea, index }: { idea: ContentIdea; index: number }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border p-2 ${FORMAT_COLOR}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-sky-400/20 text-[10px] font-bold text-sky-300">{index + 1}</span>
        <span className="font-semibold text-white/90">{idea.format}</span>
      </div>
      <p className="text-white/70">🪝 {idea.hook}</p>
      <ol className="flex flex-col gap-1">
        {idea.steps.map((s, i) => (
          <li key={i} className="flex gap-1.5 text-white/75">
            <span className="text-white/35">{i + 1}.</span>{s}
          </li>
        ))}
      </ol>
      <p className="text-white/60">📣 {idea.cta}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/35">Necesitás: {idea.needs}</p>
    </div>
  );
}

/** Las 3 ideas de Agustina, una tarjeta por idea en vez de un bloque de texto. */
export function ContentCreatorPanel({ context }: { context: BusinessContext }) {
  const [loaded, setLoaded] = useState<{ context: BusinessContext; value: { date: string; ideas: ContentIdea[] } | null } | null>(null);
  useEffect(() => { loadContentIdeas(context).then((value) => setLoaded({ context, value })); }, [context]);
  const data = loaded?.context === context ? loaded.value : undefined;

  if (data === undefined) return <p className="text-xs text-white/50">Cargando…</p>;
  if (!data || data.ideas.length === 0) return <p className="text-xs text-white/50">Todavía no hay ideas para hoy.</p>;

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {data.ideas.map((idea, i) => <IdeaCard key={i} idea={idea} index={i} />)}
    </div>
  );
}
