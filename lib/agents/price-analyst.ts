import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentModule } from "@/lib/agents/runtime";
import { entryKey, loadCatalogIndex, matchCatalog, needsReview, type CatalogEntry } from "@/lib/agents/catalog-match";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

interface DecisionKey {
  hub_product_id: string | null;
  nexios_catalog_id: string | null;
  category: Category;
  model: string;
  capacity: string | null;
}

/**
 * Lucas sigue leyendo todo el día: un proveedor puede actualizar un precio fuera de la ventana de
 * la mañana. Cada vez que eso pasa, Martín vuelve a comparar. Si ya había una comparación de ese
 * mismo producto esperando aprobación (todavía no confirmada ni corregida), la ACTUALIZA ahí mismo
 * en vez de dejar una segunda fila duplicada. Si la de antes ya se había aprobado, esta es una nueva.
 */
async function upsertDecision(db: SupabaseClient, today: string, key: DecisionKey, fields: Record<string, unknown>): Promise<void> {
  let q = db
    .from("price_updates")
    .select("id")
    .gte("created_at", `${today}T00:00:00-03:00`)
    .not("review_status", "in", "(confirmed,corrected)");

  if (key.hub_product_id) {
    q = q.eq("hub_product_id", key.hub_product_id);
  } else if (key.nexios_catalog_id) {
    q = q.eq("nexios_catalog_id", key.nexios_catalog_id);
  } else {
    q = q.is("hub_product_id", null).is("nexios_catalog_id", null).eq("category", key.category).eq("model", key.model);
    q = key.capacity ? q.eq("capacity", key.capacity) : q.is("capacity", null);
  }

  const { data: existing } = await q.limit(1).maybeSingle<{ id: string }>();
  if (existing) await db.from("price_updates").update(fields).eq("id", existing.id);
  else await db.from("price_updates").insert(fields);
}

interface Quote {
  id: string;
  supplier_id: string | null;
  category: Category;
  model: string;
  capacity: string | null;
  cost_usd: number;
  original_price_usd: number;
  pricing_basis: "unit" | "bulk_min";
  bulk_qty: number | null;
  confidence: number;
  raw_line: string | null;
  message_id: string | null;
}

interface Decision {
  category: Category;
  model: string;
  capacity: string | null;
  cost: number;
  previous: number | null;
  winnerSupplier: string;
  competitors: number;
  bestRejectedBy: string | null;
  bestRejectedCost: number | null;
  result: "routine" | "pending" | "unchanged" | "new_model";
  newPrice: number | null;
  previousPrice: number | null;
}

function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/**
 * Price Analyst (Martín): a las 11, cuando ya llegaron las listas del día, compara las cotizaciones
 * que guardó Lucas (Price Reader) entre TODOS los proveedores, elige la más barata de cada producto,
 * y recién ahí modifica la app — salvo que el cambio sea raro, en cuyo caso lo deja pidiendo tu revisión.
 */
export const priceAnalyst: AgentModule = {
  id: "price-analyst",
  contexts: ["BNB"],
  requiredEnv: ["NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    const today = todayArt();
    const { data: quotes, error } = await ctx.db
      .from("price_quotes")
      .select("id, supplier_id, category, model, capacity, cost_usd, original_price_usd, pricing_basis, bulk_qty, confidence, raw_line, message_id")
      .eq("quote_date", today)
      .returns<Quote[]>();
    if (error) throw new Error(`price_quotes: ${error.message}`);

    if (!quotes?.length) {
      return {
        markdown: `# Comparación de precios\n\nTodavía no hay cotizaciones de hoy para comparar.\n\n## Para hoy\n- Esperá a que Lucas lea las listas de los proveedores; vuelvo a correr a las 11.`,
        summary: "sin cotizaciones para comparar",
        data: { quotes: 0, decisions: [] },
      };
    }

    // Nombres de proveedor para el informe
    const supplierIds = [...new Set(quotes.map((q) => q.supplier_id).filter((v): v is string => !!v))];
    const supplierNames = new Map<string, string>();
    if (supplierIds.length) {
      const { data: sup } = await ctx.db.from("suppliers").select("id, name, phone").in("id", supplierIds);
      for (const s of sup ?? []) supplierNames.set(s.id, s.name ?? s.phone);
    }
    const nameOf = (id: string | null) => (id ? supplierNames.get(id) ?? "proveedor" : "proveedor sin identificar");

    // Agrupar por producto (categoría + modelo + capacidad normalizados) y quedarse con la cotización más barata.
    const groups = new Map<string, Quote[]>();
    for (const q of quotes) {
      const key = entryKey(q.category, q.model, q.capacity);
      const list = groups.get(key) ?? [];
      list.push(q);
      groups.set(key, list);
    }

    const index = await loadCatalogIndex(ctx.db);
    const decisions: Decision[] = [];

    for (const [, group] of groups) {
      const sorted = [...group].sort((a, b) => a.cost_usd - b.cost_usd);
      const best = sorted[0];
      const second = sorted[1];
      const entry: CatalogEntry | null = matchCatalog(index, best.category, best.model, best.capacity);

      if (!entry) {
        await upsertDecision(ctx.db, today, { hub_product_id: null, nexios_catalog_id: null, category: best.category, model: best.model, capacity: best.capacity }, {
          category: best.category, model: best.model, capacity: best.capacity,
          detected_cost_usd: best.cost_usd, original_price_usd: best.original_price_usd,
          pricing_basis: best.pricing_basis, bulk_qty: best.bulk_qty, confidence: best.confidence,
          raw_line: best.raw_line, message_id: best.message_id, supplier_id: best.supplier_id,
          status: "new_model", review_status: "pending",
        });
        decisions.push({
          category: best.category, model: best.model, capacity: best.capacity, cost: best.cost_usd, previous: null,
          winnerSupplier: nameOf(best.supplier_id), competitors: group.length,
          bestRejectedBy: second ? nameOf(second.supplier_id) : null, bestRejectedCost: second?.cost_usd ?? null,
          result: "new_model", newPrice: null, previousPrice: null,
        });
        continue;
      }

      const previous = entry.cost_usd;
      if (previous != null && Math.abs(previous - best.cost_usd) < 1) {
        await upsertDecision(ctx.db, today, { hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, category: best.category, model: entry.model, capacity: entry.capacity }, {
          category: best.category, model: entry.model, capacity: entry.capacity,
          detected_cost_usd: best.cost_usd, previous_cost_usd: previous, original_price_usd: best.original_price_usd,
          pricing_basis: best.pricing_basis, bulk_qty: best.bulk_qty, confidence: best.confidence,
          raw_line: best.raw_line, message_id: best.message_id, supplier_id: best.supplier_id,
          hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, status: "unchanged", review_status: "auto",
        });
        decisions.push({
          category: best.category, model: entry.model, capacity: entry.capacity, cost: best.cost_usd, previous,
          winnerSupplier: nameOf(best.supplier_id), competitors: group.length,
          bestRejectedBy: second ? nameOf(second.supplier_id) : null, bestRejectedCost: second?.cost_usd ?? null,
          result: "unchanged", newPrice: null, previousPrice: null,
        });
        continue;
      }

      // Martín NUNCA aplica solo: decide y queda recomendado. Lo que modifica la app es la
      // aprobación de Nacho (uno por uno o con "Aplicar todo lo recomendado"), sin excepción.
      const isRoutine = !needsReview({ pricingBasis: best.pricing_basis, confidence: best.confidence, previousCost: previous, cost: best.cost_usd });
      await upsertDecision(ctx.db, today, { hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, category: best.category, model: entry.model, capacity: entry.capacity }, {
        category: best.category, model: entry.model, capacity: entry.capacity,
        detected_cost_usd: best.cost_usd, previous_cost_usd: previous,
        original_price_usd: best.original_price_usd, pricing_basis: best.pricing_basis, bulk_qty: best.bulk_qty,
        confidence: best.confidence, raw_line: best.raw_line, message_id: best.message_id, supplier_id: best.supplier_id,
        hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, status: "detected", review_status: "pending",
      });
      decisions.push({
        category: best.category, model: entry.model, capacity: entry.capacity, cost: best.cost_usd, previous,
        winnerSupplier: nameOf(best.supplier_id), competitors: group.length,
        bestRejectedBy: second ? nameOf(second.supplier_id) : null, bestRejectedCost: second?.cost_usd ?? null,
        result: isRoutine ? "routine" : "pending", newPrice: null, previousPrice: null,
      });
    }

    const routine = decisions.filter((d) => d.result === "routine");
    const pending = decisions.filter((d) => d.result === "pending");
    const newModels = decisions.filter((d) => d.result === "new_model");
    const unchanged = decisions.filter((d) => d.result === "unchanged");

    const lines: string[] = ["# Comparación de precios", ""];
    lines.push(`Comparé ${quotes.length} cotizaciones de ${supplierIds.length || 1} ${supplierIds.length === 1 ? "proveedor" : "proveedores"} en ${groups.size} productos. Para cada uno, elegí el precio más barato. Todavía no toqué nada: queda esperando tu aprobación.`);

    if (routine.length) {
      lines.push("", "## Recomendados, el cambio es chico y confiable");
      for (const d of routine) {
        const vs = d.competitors > 1 && d.bestRejectedBy ? ` · le gané a ${d.bestRejectedBy} (US$ ${d.bestRejectedCost})` : "";
        lines.push(`- **${d.model}${d.capacity ? " " + d.capacity : ""}**: US$ ${d.previous ?? "?"} → US$ ${d.cost} de ${d.winnerSupplier}${vs}`);
      }
    }
    if (pending.length) {
      lines.push("", "## 👀 Mirá estos con más cuidado");
      for (const d of pending) {
        const pct = d.previous ? Math.round(((d.cost - d.previous) / d.previous) * 100) : null;
        lines.push(`- **${d.model}${d.capacity ? " " + d.capacity : ""}**: US$ ${d.previous ?? "?"} → US$ ${d.cost} de ${d.winnerSupplier}${pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}`);
      }
    }
    if (newModels.length) {
      lines.push("", "## Modelos que no están en el catálogo");
      for (const d of newModels) lines.push(`- ${CATEGORY_LABEL[d.category]}: ${d.model}${d.capacity ? " " + d.capacity : ""} a US$ ${d.cost} de ${d.winnerSupplier}`);
    }
    if (unchanged.length) lines.push("", `Sin cambios: ${unchanged.length} productos ya estaban al precio más barato del día.`);
    lines.push("", "## Para hoy");
    if (routine.length || pending.length) lines.push(`- Tocá a Lucas y aprobá: "Aplicar todo lo recomendado" para los ${routine.length} chicos, o uno por uno si querés mirarlos primero.`);
    if (newModels.length) lines.push(`- Decidí si sumás al catálogo los ${newModels.length} modelos nuevos.`);
    if (!routine.length && !pending.length && !newModels.length) lines.push("- Nada: ya está todo al mejor precio del día.");

    return {
      markdown: lines.join("\n"),
      summary: `${routine.length + pending.length} recomendados esperando tu aprobación${newModels.length ? `, ${newModels.length} nuevos` : ""}`,
      data: { quotes: quotes.length, products: groups.size, decisions },
    };
  },
};
