import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogModelText, DEVICE_TO_CATEGORY, fetchCatalog, normalizeCapacity, normalizeModel, type NexiosCatalogRow } from "@/lib/nexios";
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
  /** RAM del catálogo (ej. "16GB"), solo presente cuando hay más de una fila con la misma clave y
   * hace falta para desambiguar cuál es cuál. */
  ram?: string | null;
}

/** Distancia de edición entre dos strings (cuántas letras hay que cambiar/agregar/sacar para que
 * sean iguales). Base de la tolerancia a errores de tipeo y variantes de ortografía. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[n];
}

/**
 * ¿"canceling" y "cancelling" son la misma palabra? Sí — inglés americano vs británico, un
 * proveedor la escribe distinto que como está cargada en NexiOS. En vez de ir corrigiendo cada
 * variante de ortografía a mano, se tolera una letra de diferencia por cada ~6 letras de la
 * palabra. Nunca en números (un "11" nunca puede machear con un "13": la plata y la capacidad
 * dependen de eso) ni en palabras muy cortas (ahí una letra de diferencia SÍ puede ser otra
 * palabra, como "air" vs "max").
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (a.length < 6 || b.length < 6) return false;
  const tolerance = Math.floor(Math.max(a.length, b.length) / 6);
  return levenshtein(a, b) <= tolerance;
}

/** Modelo + chip + celular + pulgadas + mm (Watch) como un solo texto, para comparar: el catálogo
 * (NexiOS/hub) no tiene esos campos separados, los trae adentro del nombre del modelo ("MacBook Air
 * M5 13", "Apple Watch SE 3 40mm"), así que las cotizaciones (que sí los separan) arman el mismo
 * texto completo acá para poder compararse contra eso.
 * Las pulgadas se redondean hacia abajo: Apple vende "13.6"" como MacBook Air 13" y "15.3"" como de 15",
 * así que un proveedor que cotiza el valor exacto (15.3) y el catálogo que solo guarda 15 tienen que
 * poder machear igual — sin esto, un MacBook Air de 15.3" nunca encontraba su fila ya cargada.
 * La RAM NO entra acá a propósito: muchos proveedores no la mencionan, y si formara parte de la
 * clave un producto con una sola variante de RAM dejaría de machear apenas un proveedor no la
 * dijera. Cuando hay más de una fila del catálogo con la misma clave (un modelo que sí existe en
 * más de una RAM), matchCatalog desambigua aparte con la RAM si la cotización la trae. */
function fullModelText(model: string, chip: string | null | undefined, cellular?: boolean | null, inches?: number | null, screenMm?: number | null): string {
  return [model, chip, cellular ? "Cell" : null, inches ? `${Math.floor(inches)}"` : null, screenMm ? `${screenMm}mm` : null].filter(Boolean).join(" ");
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
  cellular?: boolean | null,
  screenMm?: number | null,
): string {
  const tokens = normalizeModel(fullModelText(model, chip, cellular, inches, screenMm)).split(/\s+/).filter(Boolean).sort();
  return `${category}|${tokens.join(" ")}|${normalizeCapacity(capacity)}`;
}

/**
 * Índice del catálogo: NexiOS si está, y siempre los products del hub. Guarda un ARRAY por clave
 * porque a veces hay más de una fila con el mismo modelo+chip+pantalla+capacidad, distintas solo
 * por RAM (ej. MacBook Pro M5 14" 1TB existe con 16GB y con 24GB) — matchCatalog desambigua esos
 * casos con la RAM que haya detectado Lucas, si la detectó.
 */
export async function loadCatalogIndex(db: SupabaseClient): Promise<Map<string, CatalogEntry[]>> {
  const index = new Map<string, CatalogEntry[]>();
  const push = (key: string, entry: CatalogEntry) => {
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  };

  const nexiosRows = (await fetchCatalog()) ?? [];
  for (const r of nexiosRows as NexiosCatalogRow[]) {
    const category = DEVICE_TO_CATEGORY[r.device_type];
    if (!category) continue;
    const model = catalogModelText(r);
    const key = entryKey(category, model, r.capacity);
    push(key, { key, category, model, capacity: r.capacity, cost_usd: r.cost_usd, margin_usd: r.margin_usd, nexios_id: r.id, hub_id: null, ram: r.attributes?.ram ?? null });
  }
  const { data: hub } = await db
    .from("products")
    .select("id, category, model, capacity, cost_usd, margin_usd, price_usd, nexios_catalog_id")
    .eq("is_active", true);
  for (const p of hub ?? []) {
    const key = entryKey(p.category as Category, p.model, p.capacity);
    const list = index.get(key);
    const match = list?.find((e) => e.nexios_id === p.nexios_catalog_id) ?? (list?.length === 1 ? list[0] : undefined);
    if (match) {
      match.hub_id = p.id;
      if (match.cost_usd == null && p.cost_usd != null) match.cost_usd = Number(p.cost_usd);
    } else {
      push(key, {
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
  index: Map<string, CatalogEntry[]>,
  category: Category,
  model: string,
  capacity: string | null,
  chip?: string | null,
  inches?: number | null,
  cellular?: boolean | null,
  ramGb?: number | null,
  screenMm?: number | null,
): CatalogEntry | null {
  const pick = (list: CatalogEntry[]): CatalogEntry | null => {
    if (list.length === 1) return list[0];
    // Más de una fila con la misma clave (distintas solo por RAM): si la cotización trae la RAM,
    // nos quedamos con la que coincide. Si no la trae, o no coincide con ninguna, es ambiguo —
    // mejor dejarlo sin aplicar (pasa a revisión) que aplicarle el costo a la fila equivocada.
    if (ramGb == null) return null;
    const matches = list.filter((e) => e.ram && parseInt(e.ram, 10) === ramGb);
    return matches.length === 1 ? matches[0] : null;
  };

  const exactList = index.get(entryKey(category, model, capacity, chip, inches, cellular, screenMm));
  if (exactList) {
    const exact = pick(exactList);
    if (exact) return exact;
  }
  // Lucas puede detectar menos detalle del que ya tiene cargado el catálogo (ej. cotización dice
  // "NEO 13" y el catálogo ya tiene "MacBook NEO A18 Pro 13"): si TODO lo que detectó está contenido
  // en una fila del catálogo, es la misma. Nunca al revés — si lo detectado tiene palabras DE MÁS
  // que el catálogo no tiene (ej. "AirPods 4 Noise Cancelling" cuando el catálogo solo tiene
  // "AirPods 4" a secas), esas palabras de más pueden ser un producto realmente distinto, así que
  // no se adivina: queda sin aplicar y aparece como modelo nuevo para que Nacho decida.
  const wantTokens = new Set(normalizeModel(fullModelText(model, chip, cellular, inches, screenMm)).split(/\s+/).filter(Boolean));
  const wantCap = normalizeCapacity(capacity);
  const candidates = [...index.values()].flat().filter((e) => {
    if (e.category !== category || normalizeCapacity(e.capacity) !== wantCap) return false;
    const eTokens = normalizeModel(e.model).split(/\s+/).filter(Boolean);
    return [...wantTokens].every((t) => eTokens.some((e2) => wordsMatch(t, e2)));
  });
  return candidates.length === 1 ? candidates[0] : pick(candidates);
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
