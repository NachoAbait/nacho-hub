/** Esqueleto genérico mientras un panel carga su primer dato. Mismo look en todos los paneles del hub. */
export function PanelSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="h-12 rounded-lg bg-white/5" />
        <div className="h-12 rounded-lg bg-white/5" />
      </div>
      <div className="h-3 w-2/3 rounded bg-white/5" />
      <div className="h-10 rounded-lg bg-white/5" />
      <div className="h-10 w-5/6 rounded-lg bg-white/5" />
      <div className="h-10 w-3/4 rounded-lg bg-white/5" />
    </div>
  );
}

/** Esqueleto chico para una sección que carga dentro de un panel ya visible (ej. una lista). */
export function ListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-1.5">
      <div className="h-8 rounded-lg bg-white/5" />
      <div className="h-8 w-5/6 rounded-lg bg-white/5" />
      <div className="h-8 w-4/6 rounded-lg bg-white/5" />
    </div>
  );
}
