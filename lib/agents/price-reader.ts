import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson } from "@/lib/claude";
import type { AgentContext, AgentModule } from "@/lib/agents/runtime";
import { systemPrompt } from "@/lib/agents/skills";
import {
  CATEGORY_TO_DEVICE,
  DEVICE_TO_CATEGORY,
  fetchCatalog,
  nexiosAvailable,
  normalizeCapacity,
  normalizeModel,
  updateCatalogCost,
  type NexiosCatalogRow,
} from "@/lib/nexios";
import { generateAllBanners } from "@/lib/designer/generate";
import { syncProductsFromNexios } from "@/lib/designer/sync";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/types";

const ItemSchema = z.object({
  category: z.enum(["iphone", "ipad", "macbook", "watch", "airpods", "samsung", "other"]),
  model: z.string(),
  capacity: z.string().nullable(),
  color: z.string().nullable(),
  condition: z.enum(["new", "used"]),
  price: z.number(),
  currency: z.enum(["USD", "ARS"]),
  confidence: z.number(),
  note: z.string().nullable(),
});

const ParseSchema = z.object({
  supplier_name: z.string().nullable(),
  list_date: z.string().nullable(),
  items: z.array(ItemSchema),
  skipped: z.array(z.string()),
});

export type ParsedList = z.infer<typeof ParseSchema>;
export type ParsedItem = z.infer<typeof ItemSchema>;

interface SupplierMessage {
  id: string;
  source: string;
  sender: string | null;
  sender_name: string | null;
  received_at: string;
  body: string;
}

interface CatalogEntry {
  key: string;
  category: Category;
  model: string;
  capacity: string | null;
  cost_usd: number | null;
  margin_usd: number | null;
  nexios_id: string | null;
  hub_id: string | null;
}

function entryKey(category: Category, model: string, capacity: string | null | undefined): string {
  return `${category}|${normalizeModel(model)}|${normalizeCapacity(capacity)}`;
}

/** Índice del catálogo: NexiOS si está, y siempre los products del hub. */
async function loadCatalogIndex(db: SupabaseClient): Promise<Map<string, CatalogEntry>> {
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

/** Busca el producto del catálogo para un ítem parseado: exacto por clave, si no por modelo contenido. */
function matchEntry(index: Map<string, CatalogEntry>, item: ParsedItem): CatalogEntry | null {
  if (item.category === "other") return null;
  const category = item.category as Category;
  const exact = index.get(entryKey(category, item.model, item.capacity));
  if (exact) return exact;
  const wantModel = normalizeModel(item.model);
  const wantCap = normalizeCapacity(item.capacity);
  const candidates = [...index.values()].filter(
    (e) => e.category === category && normalizeCapacity(e.capacity) === wantCap &&
      (normalizeModel(e.model) === wantModel || normalizeModel(e.model).endsWith(" " + wantModel) || wantModel.endsWith(" " + normalizeModel(e.model))),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export async function parseSupplierMessage(ctx: AgentContext, msg: SupplierMessage, catalogSummary: string): Promise<ParsedList> {
  return askJson({
    agent: "price-reader",
    role: "parser",
    system: systemPrompt("price-reader"),
    prompt: `Catálogo actual (categoría | modelo | capacidad | costo US$):\n${catalogSummary}\n\n` +
      `Mensaje recibido el ${msg.received_at} de ${msg.sender_name ?? msg.sender ?? "desconocido"}:\n\n"""\n${msg.body}\n"""\n\n` +
      `Extraé todos los ítems con precio.`,
    schema: ParseSchema,
    usage: ctx.usage,
    maxTokens: 6000,
  });
}

interface Applied {
  category: Category;
  model: string;
  capacity: string | null;
  previous: number | null;
  cost: number;
  newPrice: number | null;
  status: string;
}

/**
 * Price Reader (Lucas): lee las listas de proveedores que llegaron, actualiza costos y precios
 * en NexiOS y en el hub, y regenera los banners de las categorías que cambiaron.
 */
export const priceReader: AgentModule = {
  id: "price-reader",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY", "NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const { data: messages, error } = await ctx.db
      .from("supplier_messages")
      .select("id, source, sender, sender_name, received_at, body")
      .is("parsed_at", null)
      .gte("received_at", since)
      .order("received_at", { ascending: true })
      .limit(20)
      .returns<SupplierMessage[]>();
    if (error) throw new Error(`supplier_messages: ${error.message}`);

    if (!messages?.length) {
      return {
        markdown: `# Listas de proveedores\n\nNo llegaron listas nuevas en los últimos 3 días.\n\n` +
          `Para que lleguen solas, el puente de WhatsApp tiene que estar corriendo en la Mac (carpeta bridge/whatsapp). ` +
          `También podés pegar una lista a mano desde mi panel.\n\n## Para hoy\n- Nada que hacer con precios.`,
        summary: "sin listas nuevas",
        data: { messages: 0, applied: [], new_models: [] },
      };
    }

    const index = await loadCatalogIndex(ctx.db);
    const catalogSummary = [...index.values()]
      .map((e) => `${e.category} | ${e.model} | ${e.capacity ?? "-"} | ${e.cost_usd ?? "?"}`)
      .join("\n");

    const applied: Applied[] = [];
    const newModels: { category: string; model: string; capacity: string | null; cost: number }[] = [];
    const unchanged: string[] = [];
    const touched = new Set<Category>();
    let itemsTotal = 0;

    for (const msg of messages) {
      let parsed: ParsedList;
      try {
        parsed = await parseSupplierMessage(ctx, msg, catalogSummary);
      } catch (err) {
        ctx.log(`no pude parsear ${msg.id}: ${err instanceof Error ? err.message : err}`);
        await ctx.db.from("supplier_messages").update({ parsed_at: new Date().toISOString(), parse_json: { error: String(err) }, run_id: ctx.runId }).eq("id", msg.id);
        continue;
      }
      await ctx.db.from("supplier_messages").update({ parsed_at: new Date().toISOString(), parse_json: parsed, run_id: ctx.runId }).eq("id", msg.id);

      for (const item of parsed.items) {
        itemsTotal++;
        if (item.category === "other" || item.currency !== "USD" || item.condition !== "new" || item.confidence < 0.6) continue;
        const entry = matchEntry(index, item);
        const category = item.category as Category;
        const cost = Math.round(item.price);

        if (!entry) {
          newModels.push({ category, model: item.model, capacity: item.capacity, cost });
          await ctx.db.from("price_updates").insert({
            message_id: msg.id, category, model: item.model, capacity: item.capacity,
            detected_cost_usd: cost, status: "new_model", note: "No está en el catálogo",
          });
          continue;
        }

        if (entry.cost_usd != null && Math.abs(entry.cost_usd - cost) < 1) {
          unchanged.push(`${entry.model} ${entry.capacity ?? ""}`.trim());
          await ctx.db.from("price_updates").insert({
            message_id: msg.id, category, model: entry.model, capacity: entry.capacity,
            detected_cost_usd: cost, previous_cost_usd: entry.cost_usd, hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, status: "unchanged",
          });
          continue;
        }

        // Aplicar: NexiOS primero (fuente de verdad), después el hub.
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
          await ctx.db.from("products").update({ cost_usd: cost, ...(newPrice != null ? { price_usd: newPrice } : {}) }).eq("id", entry.hub_id);
        }
        await ctx.db.from("price_updates").insert({
          message_id: msg.id, category, model: entry.model, capacity: entry.capacity,
          detected_cost_usd: cost, previous_cost_usd: entry.cost_usd, new_price_usd: newPrice,
          hub_product_id: entry.hub_id, nexios_catalog_id: entry.nexios_id, status, applied_at: new Date().toISOString(),
        });
        entry.cost_usd = cost;
        touched.add(category);
        applied.push({ category, model: entry.model, capacity: entry.capacity, previous: entry.cost_usd, cost, newPrice, status });
      }
    }

    // Con la página actualizada, los banners de las categorías tocadas se regeneran solos.
    let banners: { category: Category; ok: boolean; url: string | null }[] = [];
    if (touched.size) {
      if (nexiosAvailable()) await syncProductsFromNexios(ctx.db);
      const results = await generateAllBanners([...touched].filter((c) => (CATEGORIES as readonly string[]).includes(c)));
      banners = results.map((r) => ({ category: r.category, ok: r.ok, url: r.banner?.image_url ?? null }));
    }

    const lines: string[] = ["# Listas de proveedores", ""];
    lines.push(`Leí ${messages.length} ${messages.length === 1 ? "lista" : "listas"} con ${itemsTotal} ítems.`);
    if (applied.length) {
      lines.push("", "## Costos actualizados");
      for (const a of applied) {
        const dir = a.previous == null ? "nuevo costo" : a.cost > a.previous ? "↑ subió" : "↓ bajó";
        lines.push(`- **${a.model}${a.capacity ? " " + a.capacity : ""}**: ${a.previous != null ? `US$ ${a.previous} → ` : ""}US$ ${a.cost} (${dir})${a.newPrice != null ? ` · precio de venta US$ ${a.newPrice}` : ""}${a.status === "pending_nexios" ? " · pendiente de aplicar en NexiOS" : ""}`);
      }
    }
    if (newModels.length) {
      lines.push("", "## Modelos que no están en el catálogo");
      for (const n of newModels) lines.push(`- ${CATEGORY_LABEL[n.category as Category] ?? n.category}: ${n.model}${n.capacity ? " " + n.capacity : ""} a US$ ${n.cost}`);
    }
    if (unchanged.length) lines.push("", `Sin cambios: ${unchanged.slice(0, 12).join(", ")}${unchanged.length > 12 ? "…" : ""}.`);
    if (banners.length) {
      lines.push("", "## Banners regenerados");
      for (const b of banners) lines.push(`- ${CATEGORY_LABEL[b.category]}: ${b.ok ? `[ver](${b.url})` : "falló"}`);
    }
    lines.push("", "## Para hoy");
    if (newModels.length) lines.push(`- Decidí si sumás al catálogo los ${newModels.length} modelos nuevos (con su margen).`);
    if (applied.some((a) => a.status === "pending_nexios")) lines.push("- Cargá la service role key de NexiOS para que los costos se apliquen solos en la página.");
    if (applied.length) lines.push(`- Revisá los precios de venta nuevos antes de publicar los banners.`);
    if (!applied.length && !newModels.length) lines.push("- Nada: los costos siguen iguales.");

    return {
      markdown: lines.join("\n"),
      summary: `${applied.length} costos actualizados, ${newModels.length} modelos nuevos`,
      data: { messages: messages.length, items: itemsTotal, applied, new_models: newModels, unchanged, banners },
    };
  },
};

/** Guarda un mensaje crudo de proveedor. Lo usan el puente de WhatsApp y el panel. */
export async function ingestSupplierMessage(
  db: SupabaseClient,
  input: { source: "whatsapp" | "manual"; sender?: string | null; sender_name?: string | null; body: string; received_at?: string },
): Promise<string> {
  const { data, error } = await db
    .from("supplier_messages")
    .insert({
      source: input.source,
      sender: input.sender ?? null,
      sender_name: input.sender_name ?? null,
      body: input.body,
      received_at: input.received_at ?? new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`No pude guardar el mensaje: ${error?.message}`);
  return data.id;
}

export { CATEGORY_TO_DEVICE };
