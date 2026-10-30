import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCost, entryKey } from "@/lib/agents/catalog-match";
import { nexios } from "@/lib/nexios";
import type { Category } from "@/lib/types";

export interface ComparisonQuote {
  supplierId: string;
  supplierName: string;
  cost: number;
  originalPrice: number;
  pricingBasis: "unit" | "bulk_min";
  bulkQty: number | null;
  confidence: number;
  rawLine: string | null;
  messageId: string | null;
}

export interface ComparisonRow {
  category: Category;
  model: string;
  chip: string | null;
  cellular: boolean;
  inches: number | null;
  capacity: string | null;
  ramGb: number | null;
  quotes: ComparisonQuote[];
  /** Fila de price_updates de hoy para este producto (la que creó o actualizó Martín), si existe. */
  updateId: string | null;
  winnerSupplierId: string | null;
  reviewStatus: string | null;
}

interface RawQuote {
  supplier_id: string | null;
  category: Category;
  model: string;
  chip: string | null;
  cellular: boolean;
  inches: number | null;
  capacity: string | null;
  ram_gb: number | null;
  cost_usd: number;
  original_price_usd: number;
  pricing_basis: "unit" | "bulk_min";
  bulk_qty: number | null;
  confidence: number;
  raw_line: string | null;
  message_id: string | null;
}

interface RawUpdate {
  id: string;
  category: string | null;
  model: string;
  capacity: string | null;
  supplier_id: string | null;
  review_status: string;
  created_at: string;
}

/** El mismo cuadro que la comparativa Excel, pero con el detalle completo de cada cotización (para poder aplicar) y cruzado con lo que ya decidió Martín hoy. */
export async function loadComparisonRows(db: SupabaseClient, today: string): Promise<ComparisonRow[]> {
  const [{ data: quotes }, { data: suppliers }, { data: updates }] = await Promise.all([
    db
      .from("price_quotes")
      .select("supplier_id, category, model, chip, cellular, inches, capacity, ram_gb, cost_usd, original_price_usd, pricing_basis, bulk_qty, confidence, raw_line, message_id")
      .eq("quote_date", today)
      .returns<RawQuote[]>(),
    db.from("suppliers").select("id, name, phone").returns<{ id: string; name: string | null; phone: string }[]>(),
    // A diferencia de Martín (que no quiere duplicar una decisión ya aprobada), acá SÍ queremos ver
    // la fila aunque ya esté "corrected" o "confirmed": si no, el ganador que Nacho eligió a mano
    // desaparece de la tabla apenas lo aplica.
    db
      .from("price_updates")
      .select("id, category, model, capacity, supplier_id, review_status, created_at")
      .gte("created_at", `${today}T00:00:00-03:00`)
      .order("created_at", { ascending: true })
      .returns<RawUpdate[]>(),
  ]);

  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name ?? s.phone]));
  // price_updates.model ya trae el chip pegado (del catálogo, o de best.model+chip si es un modelo nuevo),
  // así que acá se arma la clave SIN pasar chip aparte: el texto completo ya lo tiene adentro.
  const updateByKey = new Map((updates ?? []).map((u) => [entryKey((u.category ?? "other") as Category, u.model, u.capacity), u]));

  interface Row { category: Category; model: string; chip: string | null; cellular: boolean; inches: number | null; capacity: string | null; ramGb: number | null; bySupplier: Map<string, ComparisonQuote> }
  const rows = new Map<string, Row>();
  for (const q of quotes ?? []) {
    if (!q.supplier_id) continue;
    const key = entryKey(q.category, q.model, q.capacity, q.chip, q.inches, q.cellular);
    let row = rows.get(key);
    if (!row) {
      row = { category: q.category, model: q.model, chip: q.chip, cellular: q.cellular, inches: q.inches, capacity: q.capacity, ramGb: q.ram_gb, bySupplier: new Map() };
      rows.set(key, row);
    } else {
      if (!row.chip && q.chip) row.chip = q.chip;
      if (!row.inches && q.inches) row.inches = q.inches;
      if (!row.ramGb && q.ram_gb) row.ramGb = q.ram_gb;
      if (q.model.length > row.model.length) row.model = q.model;
    }
    const prev = row.bySupplier.get(q.supplier_id);
    if (!prev || q.cost_usd < prev.cost) {
      row.bySupplier.set(q.supplier_id, {
        supplierId: q.supplier_id,
        supplierName: supplierName.get(q.supplier_id) ?? q.supplier_id,
        cost: q.cost_usd,
        originalPrice: q.original_price_usd,
        pricingBasis: q.pricing_basis,
        bulkQty: q.bulk_qty,
        confidence: q.confidence,
        rawLine: q.raw_line,
        messageId: q.message_id,
      });
    }
  }

  return [...rows.entries()].map(([key, row]) => {
    const update = updateByKey.get(key);
    return {
      category: row.category,
      model: row.model,
      chip: row.chip,
      cellular: row.cellular,
      inches: row.inches,
      capacity: row.capacity,
      ramGb: row.ramGb,
      quotes: [...row.bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
      updateId: update?.id ?? null,
      winnerSupplierId: update?.supplier_id ?? null,
      reviewStatus: update?.review_status ?? null,
    };
  });
}

/**
 * Nacho elige a mano qué proveedor gana para este producto, aunque no sea el más barato. Se
 * comporta igual que "Corregir" (aplica al toque, no queda un paso intermedio esperando otra
 * aprobación): es tan explícito como escribir un precio corregido, solo que acá se toma el precio
 * real de la cotización del proveedor elegido en vez de tipearlo.
 */
export async function selectSupplierForProduct(
  db: SupabaseClient,
  updateId: string,
  quote: ComparisonQuote,
): Promise<{ status: string; newPrice: number | null }> {
  const { data: u } = await db
    .from("price_updates")
    .select("id, hub_product_id, nexios_catalog_id")
    .eq("id", updateId)
    .single<{ id: string; hub_product_id: string | null; nexios_catalog_id: string | null }>();
  if (!u) throw new Error("No encontré esa recomendación");

  let margin: number | null = null;
  if (u.nexios_catalog_id) {
    const { data } = (await nexios()?.from("price_catalog").select("margin_usd").eq("id", u.nexios_catalog_id).maybeSingle<{ margin_usd: number | null }>()) ?? { data: null };
    margin = data?.margin_usd == null ? null : Number(data.margin_usd);
  }
  if (margin == null && u.hub_product_id) {
    const { data } = await db.from("products").select("margin_usd").eq("id", u.hub_product_id).maybeSingle<{ margin_usd: number | null }>();
    margin = data?.margin_usd == null ? null : Number(data.margin_usd);
  }

  const r = await applyCost(db, { nexios_id: u.nexios_catalog_id, hub_id: u.hub_product_id, margin_usd: margin }, quote.cost);

  await db
    .from("price_updates")
    .update({
      supplier_id: quote.supplierId,
      detected_cost_usd: quote.cost,
      original_price_usd: quote.originalPrice,
      pricing_basis: quote.pricingBasis,
      bulk_qty: quote.bulkQty,
      confidence: quote.confidence,
      raw_line: quote.rawLine,
      message_id: quote.messageId,
      review_status: "corrected",
      corrected_cost_usd: quote.cost,
      reviewed_at: new Date().toISOString(),
      new_price_usd: r.newPrice,
      status: r.status,
    })
    .eq("id", updateId);

  return r;
}
