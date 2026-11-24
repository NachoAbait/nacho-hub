import type { SupabaseClient } from "@supabase/supabase-js";

/** Lo que Nacho resta del mínimo mayorista de usado: lo que le sale cambiar la batería (regla suya, 20-11-2026). */
export const USED_BATTERY_DISCOUNT_USD = 50;
/** Una cotización más vieja que esto no cuenta como "precio de hoy": se muestra marcada como vieja. */
export const USED_STALE_AFTER_DAYS = 7;
/** Ventana máxima que miramos hacia atrás (más viejo que esto = "sin dato"). */
const LOOKBACK_DAYS = 30;

/** Modelos que Nacho compra de usado (nada anterior al iPhone 13). Tope de arriba (hoy 18): Apple va a
 * seguir sacando generaciones nuevas — cuando aparezca una cotización real de un modelo más nuevo en
 * la lista de un proveedor (ver used_quotes) y el panel la siga sin mostrar, el arreglo es subir este
 * número, no reconstruir la lista. Orden de pantalla. */
const USED_MAX_GEN = 18;
export const USED_TARGET_MODELS: string[] = Array.from({ length: USED_MAX_GEN - 13 + 1 }, (_, i) => 13 + i).flatMap((n) => [
  `iPhone ${n}`,
  `iPhone ${n} Pro`,
  `iPhone ${n} Pro Max`,
]);

/**
 * Normaliza lo que escribió el parser ("iPhone 15 pro max", "IPHONE 15PM"…) a uno de los modelos
 * objetivo, o null si no es uno (Plus, mini, e, Air, anteriores al 13 o más nuevos que USED_MAX_GEN, otras categorías).
 */
export function matchUsedModel(model: string): string | null {
  const m = model.toLowerCase().replace(/\s+/g, " ").trim().match(/^iphone ?(\d{2})\s*(pro max|promax|pro|pm)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 13 || n > USED_MAX_GEN) return null;
  const v = m[2];
  const name = !v ? `iPhone ${n}` : v === "pro" ? `iPhone ${n} Pro` : `iPhone ${n} Pro Max`;
  return USED_TARGET_MODELS.includes(name) ? name : null;
}

/** Categorías estéticas, mismo orden que ya usa el resto del sistema (NexiOS, Configuración >
 * Categorías): A+ es el mejor estado, C el peor. */
export const AESTHETIC_GRADES = ["A+", "A", "B", "C"] as const;
export type AestheticGrade = (typeof AESTHETIC_GRADES)[number];

/** Franjas de batería real del equipo que trae el cliente. Por debajo de 85% no entra en plan canje
 * (requisito fijo del negocio, ver DECISIONS.md), por eso no hay franja para eso. */
export const BATTERY_TIERS = [
  { min: 90, label: "90–100%", extraUsd: 0 },
  { min: 85, label: "85–89%", extraUsd: 30 },
] as const;

/**
 * Extra que se resta además de USED_BATTERY_DISCOUNT_USD según el estado estético del equipo que
 * trae el cliente (A+ = el mismo caso de siempre, sin extra). Los números de A/B son una primera
 * estimación de Nacho (24-11-2026, "por ahí $30 más, la verdad que no sé"): quedan como constante
 * fácil de ajustar, no una fórmula — calibrar con ventas reales en cuanto haya. C es la misma
 * progresión extrapolada, sin ningún dato real detrás todavía.
 */
export const AESTHETIC_EXTRA_USD: Record<AestheticGrade, number> = {
  "A+": 0,
  "A": 30,
  "B": 60,
  "C": 90,
};

/** A qué franja de batería cae un % real, o null si está por debajo del mínimo de plan canje. */
export function batteryTierFor(batteryPct: number): (typeof BATTERY_TIERS)[number] | null {
  if (batteryPct < 85) return null;
  return BATTERY_TIERS.find((t) => batteryPct >= t.min) ?? BATTERY_TIERS[BATTERY_TIERS.length - 1];
}

/** El precio a ofrecer por un equipo concreto: el mínimo mayorista del modelo+capacidad, menos la
 * batería (fija + franja) y menos el estado estético. Nunca negativo. Null si la batería no alcanza
 * para entrar en plan canje. */
export function suggestedForCondition(minUsd: number, batteryPct: number, grade: AestheticGrade): number | null {
  const tier = batteryTierFor(batteryPct);
  if (!tier) return null;
  return Math.max(0, minUsd - USED_BATTERY_DISCOUNT_USD - tier.extraUsd - AESTHETIC_EXTRA_USD[grade]);
}

export interface UsedReferenceRow {
  model: string;
  /** Ahora es parte de la identidad de la fila, no solo un dato de la mejor cotización: un mismo
   * modelo puede tener 128/256/512GB a precios bien distintos y antes se mezclaban (se mostraba
   * el GB más barato como si fuera "el" precio del modelo, aunque el canje real fuera de otra capacidad). */
  capacity: string | null;
  /** Precio mayorista de usado más barato visto para ese modelo+capacidad (null = sin dato). */
  minUsd: number | null;
  supplier: string | null;
  date: string | null;
  stale: boolean;
  /** Mínimo − 50. Nunca negativo. */
  suggestedUsd: number | null;
}

export interface UsedReferenceData {
  rows: UsedReferenceRow[];
  discountUsd: number;
  staleAfterDays: number;
}

interface UsedQuoteDbRow {
  supplier_id: string | null;
  category: string;
  model: string;
  capacity: string | null;
  price_usd: number | string;
  quote_date: string;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
}

/** Para ordenar las capacidades de un modelo de menor a mayor (128GB, 256GB, 512GB, ...). */
function capacityGB(capacity: string | null): number {
  if (!capacity) return Infinity; // sin capacidad especificada: al final
  const m = capacity.match(/(\d+)/);
  return m ? Number(m[1]) : Infinity;
}

/** Función pura (testeable): de las filas crudas a la tabla de referencia, una fila por modelo+capacidad. */
export function buildUsedReference(
  quotes: UsedQuoteDbRow[],
  supplierNames: Map<string, string>,
  today: string,
): UsedReferenceData {
  // Por modelo+capacidad y proveedor, solo vale su cotización MÁS RECIENTE (si un proveedor subió el
  // precio, el viejo ya no existe); dentro de ese día, la más barata. Después, el mínimo entre proveedores.
  const latest = new Map<string, { model: string; capacity: string | null; supplier: string; price: number; date: string }>();
  for (const q of quotes) {
    if (q.category !== "iphone") continue;
    const model = matchUsedModel(q.model);
    const price = Number(q.price_usd);
    if (!model || !(price > 0)) continue;
    const capacity = q.capacity ?? null;
    const key = `${model}|${capacity ?? "?"}|${q.supplier_id ?? "?"}`;
    const cur = latest.get(key);
    if (!cur || q.quote_date > cur.date || (q.quote_date === cur.date && price < cur.price)) {
      latest.set(key, { model, capacity, supplier: q.supplier_id ? supplierNames.get(q.supplier_id) ?? "proveedor" : "proveedor sin identificar", price, date: q.quote_date });
    }
  }

  const rows: UsedReferenceRow[] = [];
  for (const model of USED_TARGET_MODELS) {
    const cands = [...latest.values()].filter((c) => c.model === model);
    if (!cands.length) {
      rows.push({ model, capacity: null, minUsd: null, supplier: null, date: null, stale: false, suggestedUsd: null });
      continue;
    }
    const capacities = [...new Set(cands.map((c) => c.capacity))].sort((a, b) => capacityGB(a) - capacityGB(b));
    for (const capacity of capacities) {
      const ofCapacity = cands.filter((c) => c.capacity === capacity);
      const best = ofCapacity.reduce((a, b) => (b.price < a.price || (b.price === a.price && b.date > a.date) ? b : a));
      rows.push({
        model,
        capacity,
        minUsd: best.price,
        supplier: best.supplier,
        date: best.date,
        stale: daysBetween(best.date, today) > USED_STALE_AFTER_DAYS,
        suggestedUsd: Math.max(0, best.price - USED_BATTERY_DISCOUNT_USD),
      });
    }
  }
  return { rows, discountUsd: USED_BATTERY_DISCOUNT_USD, staleAfterDays: USED_STALE_AFTER_DAYS };
}

export async function computeUsedReference(db: SupabaseClient, today: string): Promise<UsedReferenceData> {
  const since = new Date(Date.parse(today) - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const [{ data: quotes, error }, { data: sups }] = await Promise.all([
    db.from("used_quotes").select("supplier_id, category, model, capacity, price_usd, quote_date").gte("quote_date", since).eq("category", "iphone").limit(5000).returns<UsedQuoteDbRow[]>(),
    db.from("suppliers").select("id, name, phone").returns<{ id: string; name: string | null; phone: string }[]>(),
  ]);
  if (error) throw new Error(`used_quotes: ${error.message}`);
  const names = new Map((sups ?? []).map((s) => [s.id, s.name ?? s.phone]));
  return buildUsedReference(quotes ?? [], names, today);
}
