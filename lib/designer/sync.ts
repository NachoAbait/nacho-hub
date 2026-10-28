import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_TO_CATEGORY, fetchCatalog, nexiosAvailable, type NexiosCatalogRow } from "@/lib/nexios";
import type { Category } from "@/lib/types";

/** Nombre para mostrar en el banner a partir del modelo tal como está cargado en NexiOS. */
export function displayModel(deviceType: string, model: string): string {
  const m = model.trim();
  switch (deviceType) {
    case "iphone":
      return /^iphone/i.test(m) ? m.replace(/^iphone/i, "iPhone") : `iPhone ${m}`;
    case "ipad":
      return /^ipad/i.test(m) ? m.replace(/^ipad/i, "iPad") : `iPad ${m}`;
    case "apple_watch":
      return m.replace(/^apple\s*watch/i, "Apple Watch").replace(/\bultra\b/i, "Ultra");
    case "samsung":
      return /^galaxy/i.test(m) ? m.replace(/^galaxy/i, "Galaxy") : `Galaxy ${m}`;
    case "airpods":
      return m.replace(/^airpods/i, "AirPods").replace(/\bmax\b/i, "Max");
    default:
      return m;
  }
}

/** "256GB" → "256 GB", "1TB" → "1 TB". */
export function displayCapacity(capacity: string | null): string | null {
  if (!capacity) return null;
  return capacity.replace(/(\d+)\s*(gb|tb)/i, (_, n, u) => `${n} ${u.toUpperCase()}`);
}

export interface SyncResult {
  synced: boolean;
  upserted: number;
  deactivated: number;
  reason?: string;
}

/**
 * Copia el catálogo de NexiOS (la página real) a products del hub, que es lo que leen los banners.
 * - Solo sellados activos y visibles en el catálogo público.
 * - Conserva hero_image_url y display_order si ya estaban cargados en el hub.
 * - Desactiva en el hub lo que desapareció de NexiOS (solo filas con source = 'nexios').
 */
export async function syncProductsFromNexios(db: SupabaseClient): Promise<SyncResult> {
  if (!nexiosAvailable()) return { synced: false, upserted: 0, deactivated: 0, reason: "Falta NEXIOS_SUPABASE_SERVICE_ROLE_KEY" };
  const catalog = (await fetchCatalog()) ?? [];
  const visible = catalog.filter((r) => r.public_visible && r.price_usd != null);

  const { data: existing } = await db
    .from("products")
    .select("id, nexios_catalog_id, hero_image_url, display_order, source")
    .not("nexios_catalog_id", "is", null);
  const byNexios = new Map((existing ?? []).map((p) => [p.nexios_catalog_id as string, p]));

  // Orden dentro de cada categoría: como vienen de NexiOS (device_type, model, capacity)
  const orderByCat = new Map<Category, number>();
  const rows = visible
    .map((r: NexiosCatalogRow) => {
      const category = DEVICE_TO_CATEGORY[r.device_type];
      if (!category) return null;
      const n = (orderByCat.get(category) ?? 0) + 1;
      orderByCat.set(category, n);
      const prev = byNexios.get(r.id);
      return {
        ...(prev ? { id: prev.id } : {}),
        nexios_catalog_id: r.id,
        category,
        model: displayModel(r.device_type, r.model),
        capacity: displayCapacity(r.capacity),
        price_usd: r.price_usd,
        cost_usd: r.cost_usd,
        margin_usd: r.margin_usd,
        hero_image_url: prev?.hero_image_url ?? null,
        display_order: prev?.display_order ?? n,
        is_active: true,
        context: "BNB",
        source: "nexios",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let upserted = 0;
  if (rows.length) {
    const { error } = await db.from("products").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`Sync products: ${error.message}`);
    upserted = rows.length;
  }

  const keep = new Set(visible.map((r) => r.id));
  const stale = (existing ?? []).filter((p) => p.source === "nexios" && !keep.has(p.nexios_catalog_id as string));
  if (stale.length) {
    await db.from("products").update({ is_active: false }).in("id", stale.map((p) => p.id));
  }
  return { synced: true, upserted, deactivated: stale.length };
}
