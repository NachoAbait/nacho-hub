import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCost } from "@/lib/agents/catalog-match";
import type { SupplierRules } from "@/lib/agents/price-reader";
import { nexios } from "@/lib/nexios";

export interface PriceUpdateRow {
  id: string;
  supplier_id: string | null;
  category: string | null;
  model: string;
  capacity: string | null;
  detected_cost_usd: number;
  previous_cost_usd: number | null;
  new_price_usd: number | null;
  original_price_usd: number | null;
  pricing_basis: string | null;
  bulk_qty: number | null;
  adjustment_usd: number | null;
  raw_line: string | null;
  status: string;
  review_status: "pending" | "confirmed" | "corrected" | "auto";
  confidence: number | null;
  corrected_cost_usd: number | null;
  hub_product_id: string | null;
  nexios_catalog_id: string | null;
  created_at: string;
}

const COLS =
  "id, supplier_id, category, model, capacity, detected_cost_usd, previous_cost_usd, new_price_usd, original_price_usd, pricing_basis, bulk_qty, adjustment_usd, raw_line, status, review_status, confidence, corrected_cost_usd, hub_product_id, nexios_catalog_id, created_at";

/** Interpretaciones de hoy (hora Argentina), las más nuevas primero. */
export async function todaysUpdates(db: SupabaseClient, today: string): Promise<PriceUpdateRow[]> {
  const { data } = await db
    .from("price_updates")
    .select(COLS)
    .gte("created_at", `${today}T00:00:00-03:00`)
    .order("created_at", { ascending: false })
    .limit(80)
    .returns<PriceUpdateRow[]>();
  return (data ?? []).map((r) => ({ ...r, detected_cost_usd: Number(r.detected_cost_usd) }));
}

/**
 * OK de Nacho. Con el flujo nuevo (Price Analyst decide, pero no aplica lo que pide revisión),
 * esto es lo que de verdad modifica NexiOS + el hub por primera vez, con el costo detectado.
 * Si por algún motivo ya estaba aplicado (dato viejo), solo marca confirmado.
 */
export async function confirmUpdate(db: SupabaseClient, id: string): Promise<{ category: string | null; applied: boolean }> {
  const { data: u } = await db.from("price_updates").select(COLS).eq("id", id).single<PriceUpdateRow>();
  if (!u) throw new Error("No encontré esa interpretación");

  if (u.status === "detected" && (u.hub_product_id || u.nexios_catalog_id)) {
    let margin: number | null = null;
    if (u.nexios_catalog_id) {
      const { data } = await nexios()?.from("price_catalog").select("margin_usd").eq("id", u.nexios_catalog_id).maybeSingle<{ margin_usd: number | null }>() ?? { data: null };
      margin = data?.margin_usd == null ? null : Number(data.margin_usd);
    }
    if (margin == null && u.hub_product_id) {
      const { data } = await db.from("products").select("margin_usd").eq("id", u.hub_product_id).maybeSingle<{ margin_usd: number | null }>();
      margin = data?.margin_usd == null ? null : Number(data.margin_usd);
    }
    const r = await applyCost(db, { nexios_id: u.nexios_catalog_id, hub_id: u.hub_product_id, margin_usd: margin }, u.detected_cost_usd);
    await db
      .from("price_updates")
      .update({ review_status: "confirmed", reviewed_at: new Date().toISOString(), status: r.status, new_price_usd: r.newPrice, applied_at: new Date().toISOString() })
      .eq("id", id);
    return { category: u.category, applied: true };
  }

  await db.from("price_updates").update({ review_status: "confirmed", reviewed_at: new Date().toISOString() }).eq("id", id);
  return { category: u.category, applied: false };
}

/**
 * Corrección de Nacho: `listedUnitPrice` es el precio unitario correcto TAL COMO lo publicó el proveedor.
 * Se aplica la regla de descuento del proveedor, se actualiza el costo (NexiOS + hub) y se guarda
 * el ejemplo en suppliers.rules.examples (máx. 10) para el próximo prompt.
 */
export async function correctUpdate(db: SupabaseClient, id: string, listedUnitPrice: number): Promise<{ cost: number; newPrice: number | null; category: string | null }> {
  const { data: u } = await db.from("price_updates").select(COLS).eq("id", id).single<PriceUpdateRow>();
  if (!u) throw new Error("No encontré esa interpretación");

  let supplier: { id: string; rules: SupplierRules } | null = null;
  if (u.supplier_id) {
    const { data } = await db.from("suppliers").select("id, rules").eq("id", u.supplier_id).maybeSingle<{ id: string; rules: SupplierRules }>();
    supplier = data;
  }
  const discount = Number(supplier?.rules?.unit_discount_usd ?? 0) || 0;
  const cost = Math.max(0, Math.round(listedUnitPrice) - discount);

  let newPrice: number | null = null;
  let status = u.status;
  if (u.hub_product_id || u.nexios_catalog_id) {
    let margin: number | null = null;
    if (u.nexios_catalog_id) {
      const { data } = await nexios()?.from("price_catalog").select("margin_usd").eq("id", u.nexios_catalog_id).maybeSingle<{ margin_usd: number | null }>() ?? { data: null };
      margin = data?.margin_usd == null ? null : Number(data.margin_usd);
    }
    if (margin == null && u.hub_product_id) {
      const { data } = await db.from("products").select("margin_usd").eq("id", u.hub_product_id).maybeSingle<{ margin_usd: number | null }>();
      margin = data?.margin_usd == null ? null : Number(data.margin_usd);
    }
    const r = await applyCost(db, { nexios_id: u.nexios_catalog_id, hub_id: u.hub_product_id, margin_usd: margin }, cost);
    newPrice = r.newPrice;
    status = r.status;
  }

  await db
    .from("price_updates")
    .update({ review_status: "corrected", corrected_cost_usd: cost, reviewed_at: new Date().toISOString(), new_price_usd: newPrice ?? u.new_price_usd, status })
    .eq("id", id);

  if (supplier && u.raw_line) {
    const rules: SupplierRules = { ...(supplier.rules ?? {}) };
    const example = { line: u.raw_line.slice(0, 300), listed_unit_price: Math.round(listedUnitPrice), model: u.model, capacity: u.capacity, at: new Date().toISOString() };
    rules.examples = [example, ...(rules.examples ?? [])].slice(0, 10);
    await db.from("suppliers").update({ rules }).eq("id", supplier.id);
  }
  return { cost, newPrice, category: u.category };
}
