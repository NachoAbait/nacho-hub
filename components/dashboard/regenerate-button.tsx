"use client";

import { useState, useTransition } from "react";
import { regenerateBanner } from "@/app/dashboard/actions";

interface Props {
  category: string;
  /** Opcional: avisa cuando empieza y termina la generación. */
  onPendingChange?: (pending: boolean) => void;
}

export function RegenerateButton({ category, onPendingChange }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    onPendingChange?.(true);
    startTransition(async () => {
      try {
        const result = await regenerateBanner(category);
        if (!result.ok) setError(result.error ?? "Falló la generación");
      } finally {
        onPendingChange?.(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Generando…" : "Regenerar"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
