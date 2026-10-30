import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_TO_CATEGORY, fetchCatalog, normalizeCapacity, normalizeModel, type NexiosCatalogRow } from "@/lib/nexios";
import type { Category } from "@/lib/types";

/** Compartido entre Price Reader (colector) y Price Analyst (decide y aplica). */

export interface CatalogEntry {
  key: string;
  category: Category;
  model: string;
  capacity: string | null;
  cost_usd: number | null;
  margin_usd: number | null;
  nexios_id: string | null;
  hub_id: string | null;
}

/** Modelo + chip + pulgadas como un solo texto, para comparar: el catálogo (NexiOS/hub) no tiene esos
 * campos separados, los trae adentro del nombre del modelo ("MacBook Air M5 13"), así que las
 * cotizaciones (que sí los separan) arman el mismo texto completo acá para poder compararse contra eso. */
function fullModelText(model: string, chip: string | null | undefined, inches?: number | null): string {
  return [model, chip, inches ? `${inches}"` : null].filter(Boolean).join(" ");
}

/**
 * Clave para agrupar "es el mismo producto": cada proveedor escribe el modelo (y el chip, si lo separa)
 * en un orden de palabras distinto ("Air 13 M5" vs "Air M5 13”", "Pro 14 M5 Pro" vs "Pro M5 Pro 14”"),
 * así que acá SÍ se ordenan las palabras alfabéticamente para que el orden no rompa el agrupamiento
 * entre proveedores. (matchCatalog, que compara contra el catálogo real, usa normalizeModel sin
 * ordenar: ahí el orden de palabras importa para su lógica de prefijo/sufijo y no hay que tocarlo.)
 */
export function entryKey(
  category: Category,
  model: string,
  capacity: string | null | undefined,
  chip?: string | null,
  inches?: number | null,
): string {
  const tokens = normalizeModel(fullModelText(model, chip, inches)).split(/\s+/).filter(Boolean).sort();
  return `${category}|${tokens.join(" ")}|${normalizeCapacity(capacity)}`;
}

/** Índice del catálogo: NexiOS si está, y siempre los products del hub. */
export async function loadCatalogIndex(db: SupabaseClient): Promise<Map<string, CatalogEntry>> {
  const index = new Map<string, CatalogEntry>();
  const nexiosRows = (await fetchCatalog()) ?? [];
  for (const r of nexiosRows as NexiosCatalogRow[]) {
    const category = DEVICE_TO_CATEGORY[r.device_type];
    if (!category) continue;
    const key = entryKey(category, r.model, r.capacity);
    index.set(key, { key, category, model: r.model, capacity: r.capacity, cost_usd: r.cost_usd, margin_usd: r.margin_usd, nexios_id: r.id, hub_id: null });
  }
  const { data: hub } = await db
    .from("products")
    .select("id, category, model, capacity, cost_usd, margin_usd, price_usd, nexios_catalog_id")
    .eq("is_active", true);
  for (const p of hub ?? []) {
    const key = entryKey(p.category as Category, p.model, p.capacity);
    const prev = index.get(key);
    if (prev) {
      prev.hub_id = p.id;
      if (prev.cost_usd == null && p.cost_usd != null) prev.cost_usd = Number(p.cost_usd);
    } else {
      index.set(key, {
        key, category: p.category as Category, model: p.model, capacity: p.capacity,
        cost_usd: p.cost_usd == null ? null : Number(p.cost_usd),
        margin_usd: p.margin_usd == null ? null : Number(p.margin_usd),
        nexios_id: p.nexios_catalog_id ?? null, hub_id: p.id,
      });
    }
  }
  return index;
}

/** Busca el producto del catálogo para model/capacity/category dados: exacto por clave, si no por modelo contenido. */
export function matchCatalog(
  index: Map<string, CatalogEntry>,
  category: Category,
  model: string,
  capacity: string | null,
  chip?: string | null,
  inches?: number | null,
): CatalogEntry | null {
  const exact = index.get(entryKey(category, model, capacity, chip, inches));
  if (exact) return exact;
  const wantModel = normalizeModel(fullModelText(model, chip, inches));
  const wantCap = normalizeCapacity(capacity);
  const candidates = [...index.values()].filter(
    (e) => e.category === category && normalizeCapacity(e.capacity) === wantCap &&
      (normalizeModel(e.model) === wantModel || normalizeModel(e.model).endsWith(" " + wantModel) || wantModel.endsWith(" " + normalizeModel(e.model))),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * ¿Hace falta que Nacho mire este cambio, o el sistema confía solo?
 * Para confiar: precio unitario explícito (no un escalón de cantidad inferido), confianza alta del
 * modelo, ya había un costo previo para comparar, y el salto no es descabellado (±20%).
 */
export const AUTO_CONFIRM_MIN_CONFIDENCE = 0.85;
export const AUTO_CONFIRM_MAX_SWING_PCT = 0.2;

export function needsReview(opts: { pricingBasis: string; confidence: number; previousCost: number | null; cost: number }): boolean {
  if (opts.pricingBasis !== "unit") return true;
  if (opts.confidence < AUTO_CONFIRM_MIN_CONFIDENCE) return true;
  if (opts.previousCost == null) return true;
  const swing = Math.abs(opts.cost - opts.previousCost) / opts.previousCost;
  return swing > AUTO_CONFIRM_MAX_SWING_PCT;
}

/** Aplica un costo: NexiOS primero (fuente de verdad), después el hub. Precio = costo + margen. */
export async function applyCost(
  db: SupabaseClient,
  entry: { nexios_id: string | null; hub_id: string | null; margin_usd: number | null },
  cost: number,
): Promise<{ status: string; newPrice: number | null }> {
  const { nexiosAvailable, updateCatalogCost } = await import("@/lib/nexios");
  let newPrice: number | null = null;
  let status = "applied_hub_only";
  if (entry.nexios_id && nexiosAvailable()) {
    const r = await updateCatalogCost(entry.nexios_id, cost);
    newPrice = r?.priceUsd ?? null;
    status = "applied";
  } else if (entry.nexios_id) {
    status = "pending_nexios";
  }
  if (newPrice == null && entry.margin_usd != null) newPrice = cost + entry.margin_usd;
  if (entry.hub_id) {
    await db.from("products").update({ cost_usd: cost, ...(newPrice != null ? { price_usd: newPrice } : {}) }).eq("id", entry.hub_id);
  }
  return { status, newPrice };
}
