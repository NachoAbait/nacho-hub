"use client";

import { useState, useTransition } from "react";
import { runAgentNow } from "@/app/actions";

export function RunNowButton({ agentId, onPendingChange }: { agentId: string; onPendingChange?: (p: boolean) => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          onPendingChange?.(true);
          start(async () => {
            const r = await runAgentNow(agentId);
            setMsg(r.message);
            onPendingChange?.(false);
          });
        }}
        className="rounded-full bg-amber-400 px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:opacity-50"
      >
        {pending ? "Trabajando…" : "Correr ahora"}
      </button>
      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </div>
  );
}
