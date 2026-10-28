import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/lib/types";

/**
 * Acceso a NexiOS (nexiosapp.com), la "página" real de BNB Store.
 * Proyecto Supabase xlpkdztjmxslrcipxpzm, organización "BNB STORE".
 *
 * - Lectura y escritura del catálogo de precios: price_catalog (cost_usd, margin_usd, price_usd).
 * - Ventas, stock y gastos para el Stock Analyst.
 *
 * Necesita NEXIOS_SUPABASE_SERVICE_ROLE_KEY. Sin esa variable, las funciones devuelven null
 * y los agentes trabajan solo con las tablas del hub.
 */

export const NEXIOS_URL = process.env.NEXIOS_SUPABASE_URL ?? "https://xlpkdztjmxslrcipxpzm.supabase.co";
export const NEXIOS_ORG_ID = process.env.NEXIOS_ORG_ID ?? "fac40dd4-f516-4c5a-bf4d-06fa01caeee4";

let client: SupabaseClient | null = null;

export function nexiosAvailable(): boolean {
  return Boolean(process.env.NEXIOS_SUPABASE_SERVICE_ROLE_KEY);
}

export function nexios(): SupabaseClient | null {
  const key = process.env.NEXIOS_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  if (!client) client = createClient(NEXIOS_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** device_type de NexiOS → categoría del hub. */
export const DEVICE_TO_CATEGORY: Record<string, Category | null> = {
  iphone: "iphone",
  ipad: "ipad",
  macbook: "macbook",
  apple_watch: "watch",
  airpods: "airpods",
  samsung: "samsung",
  accessory: null,
};

export const CATEGORY_TO_DEVICE: Record<Category, string> = {
  iphone: "iphone",
  ipad: "ipad",
  macbook: "macbook",
  watch: "apple_watch",
  airpods: "airpods",
  samsung: "samsung",
};

export interface NexiosCatalogRow {
  id: string;
  device_type: string;
  condition: "new_sealed" | "pre_owned";
  model: string;
  capacity: string | null;
  cost_usd: number | null;
  margin_usd: number | null;
  price_usd: number | null;
  is_active: boolean;
  public_visible: boolean;
  updated_at: string;
}

/** Catálogo de sellados activo. */
export async function fetchCatalog(): Promise<NexiosCatalogRow[] | null> {
  const db = nexios();
  if (!db) return null;
  const { data, error } = await db
    .from("price_catalog")
    .select("id, device_type, condition, model, capacity, cost_usd, margin_usd, price_usd, is_active, public_visible, updated_at")
    .eq("organization_id", NEXIOS_ORG_ID)
    .eq("is_active", true)
    .eq("condition", "new_sealed")
    .order("device_type")
    .order("model")
    .order("capacity");
  if (error) throw new Error(`NexiOS price_catalog: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...r,
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    margin_usd: r.margin_usd == null ? null : Number(r.margin_usd),
    price_usd: r.price_usd == null ? null : Number(r.price_usd),
  })) as NexiosCatalogRow[];
}

/**
 * Actualiza el costo de una fila del catálogo y recalcula el precio con el margen cargado.
 * NexiOS tiene un trigger que deja el cambio en price_history.
 */
export async function updateCatalogCost(id: string, costUsd: number): Promise<{ priceUsd: number | null } | null> {
  const db = nexios();
  if (!db) return null;
  const { data: row, error } = await db
    .from("price_catalog")
    .select("margin_usd, price_usd")
    .eq("id", id)
    .single<{ margin_usd: number | null; price_usd: number | null }>();
  if (error) throw new Error(`NexiOS leer fila: ${error.message}`);
  const margin = row.margin_usd == null ? null : Number(row.margin_usd);
  const priceUsd = margin == null ? row.price_usd : costUsd + margin;
  const { error: upErr } = await db
    .from("price_catalog")
    .update({ cost_usd: costUsd, price_usd: priceUsd, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) throw new Error(`NexiOS actualizar costo: ${upErr.message}`);
  return { priceUsd: priceUsd == null ? null : Number(priceUsd) };
}

/** Normaliza nombres de modelo para comparar: minúsculas, sin "iphone"/"galaxy", sin espacios dobles. */
export function normalizeModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\b(iphone|apple ?watch|galaxy|samsung|ipad|macbook)\b/g, " ")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza capacidad: "256 GB" → "256gb", "1 TB" → "1tb". */
export function normalizeCapacity(capacity: string | null | undefined): string {
  if (!capacity) return "";
  return capacity.toLowerCase().replace(/\s+/g, "");
}

export interface SalesSummary {
  from: string;
  to: string;
  sales_count: number;
  revenue_usd: number;
  trade_ins: number;
  by_model: { model: string; units: number; revenue_usd: number }[];
}

/** Ventas de NexiOS entre dos fechas (YYYY-MM-DD), agregadas por modelo. */
export async function fetchSales(from: string, to: string): Promise<SalesSummary | null> {
  const db = nexios();
  if (!db) return null;
  const { data: sales, error } = await db
    .from("sales")
    .select("id, amount_usd, has_trade_in, sale_date")
    .eq("organization_id", NEXIOS_ORG_ID)
    .gte("sale_date", from)
    .lte("sale_date", to);
  if (error) throw new Error(`NexiOS sales: ${error.message}`);
  const ids = (sales ?? []).map((s) => s.id);
  const byModel = new Map<string, { units: number; revenue_usd: number }>();
  if (ids.length) {
    const { data: items } = await db
      .from("sale_items")
      .select("sale_id, product_id, custom_name, unit_price_usd, quantity, is_freebie, products(model, capacity)")
      .in("sale_id", ids)
      .eq("is_freebie", false);
    for (const it of items ?? []) {
      const p = (it as unknown as { products: { model: string; capacity: string | null } | null }).products;
      const name = p ? `${p.model}${p.capacity ? " " + p.capacity : ""}` : (it.custom_name ?? "otro");
      const cur = byModel.get(name) ?? { units: 0, revenue_usd: 0 };
      cur.units += it.quantity;
      cur.revenue_usd += Number(it.unit_price_usd) * it.quantity;
      byModel.set(name, cur);
    }
  }
  return {
    from,
    to,
    sales_count: sales?.length ?? 0,
    revenue_usd: (sales ?? []).reduce((n, s) => n + Number(s.amount_usd), 0),
    trade_ins: (sales ?? []).filter((s) => s.has_trade_in).length,
    by_model: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.revenue_usd - a.revenue_usd),
  };
}

export interface StockRow {
  model: string;
  capacity: string | null;
  device_type: string;
  condition: string | null;
  units: number;
  cost_usd: number;
  price_usd: number | null;
  oldest_entry: string;
}

/** Stock disponible agrupado por modelo, con antigüedad. */
export async function fetchStock(): Promise<StockRow[] | null> {
  const db = nexios();
  if (!db) return null;
  const { data, error } = await db
    .from("products")
    .select("model, capacity, device_type, condition, stock_qty, cost_usd, price_usd, entry_date")
    .eq("organization_id", NEXIOS_ORG_ID)
    .eq("status", "available");
  if (error) throw new Error(`NexiOS products: ${error.message}`);
  const map = new Map<string, StockRow>();
  for (const p of data ?? []) {
    const key = `${p.device_type}|${p.model}|${p.capacity ?? ""}|${p.condition ?? ""}`;
    const cur = map.get(key) ?? {
      model: p.model, capacity: p.capacity, device_type: p.device_type, condition: p.condition,
      units: 0, cost_usd: 0, price_usd: p.price_usd == null ? null : Number(p.price_usd), oldest_entry: p.entry_date,
    };
    cur.units += p.stock_qty ?? 1;
    cur.cost_usd += Number(p.cost_usd ?? 0) * (p.stock_qty ?? 1);
    if (p.entry_date < cur.oldest_entry) cur.oldest_entry = p.entry_date;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.oldest_entry.localeCompare(b.oldest_entry));
}

/** Gastos del período en USD (los de ARS ya vienen con fx_rate congelado). */
export async function fetchExpenses(from: string, to: string): Promise<{ total_usd: number; count: number } | null> {
  const db = nexios();
  if (!db) return null;
  const { data, error } = await db
    .from("expenses")
    .select("amount, currency, fx_rate")
    .eq("organization_id", NEXIOS_ORG_ID)
    .gte("expense_date", from)
    .lte("expense_date", to);
  if (error) throw new Error(`NexiOS expenses: ${error.message}`);
  let total = 0;
  for (const e of data ?? []) {
    const amount = Number(e.amount);
    total += e.currency === "ARS" && e.fx_rate ? amount / Number(e.fx_rate) : amount;
  }
  return { total_usd: total, count: data?.length ?? 0 };
}
