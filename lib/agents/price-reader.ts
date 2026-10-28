import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson } from "@/lib/claude";
import type { AgentContext, AgentModule } from "@/lib/agents/runtime";
import { systemPrompt } from "@/lib/agents/skills";
import type { Category } from "@/lib/types";

const ItemSchema = z.object({
  category: z.enum(["iphone", "ipad", "macbook", "watch", "airpods", "samsung", "other"]),
  model: z.string(),
  capacity: z.string().nullable(),
  color: z.string().nullable(),
  condition: z.enum(["new", "used"]),
  price: z.number(),
  currency: z.enum(["USD", "ARS"]),
  /** "unit" si el proveedor publicó precio unitario explícito; "bulk_min" si solo había escalones por cantidad. */
  pricing_basis: z.enum(["unit", "bulk_min"]),
  /** Cantidad del escalón usado cuando pricing_basis es bulk_min (x3 → 3). */
  bulk_qty: z.number().nullable(),
  /** La línea original del mensaje de la que salió el ítem. */
  raw_line: z.string(),
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
  supplier_id: string | null;
}

export interface SupplierRules {
  unit_discount_usd?: number;
  bulk_pricing?: string;
  notes?: string;
  examples?: { line: string; listed_unit_price: number; model: string; capacity: string | null; at: string }[];
}

interface SupplierRow {
  id: string;
  phone: string;
  name: string | null;
  rules: SupplierRules;
}

function supplierPrompt(supplier: SupplierRow | null): string {
  if (!supplier) return "";
  const r = supplier.rules ?? {};
  const lines: string[] = [`\nProveedor: ${supplier.name ?? supplier.phone}.`];
  if (r.bulk_pricing) lines.push(`Cómo publica por cantidad: ${r.bulk_pricing}.`);
  if (r.notes) lines.push(`Notas de Nacho sobre este proveedor: ${r.notes}`);
  if (r.unit_discount_usd) lines.push(`(El sistema le va a restar US$ ${r.unit_discount_usd} a cada precio unitario después: vos devolvé el precio tal como está publicado.)`);
  if (r.examples?.length) {
    lines.push("Correcciones anteriores de Nacho con este proveedor (aprendé de ellas):");
    for (const e of r.examples) lines.push(`- Línea "${e.line}" → ${e.model}${e.capacity ? " " + e.capacity : ""}: el precio unitario correcto publicado era US$ ${e.listed_unit_price}.`);
  }
  return lines.join("\n") + "\n";
}

/** Catálogo actual, solo como referencia para que el modelo reconozca nombres de productos (no se compara acá). */
async function catalogNames(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("products").select("category, model, capacity").eq("is_active", true);
  return (data ?? []).map((p) => `${p.category} | ${p.model} | ${p.capacity ?? "-"}`).join("\n");
}

export async function parseSupplierMessage(ctx: AgentContext, msg: SupplierMessage, catalogSummary: string, supplier: SupplierRow | null): Promise<ParsedList> {
  return askJson({
    agent: "price-reader",
    role: "parser",
    system: systemPrompt("price-reader"),
    prompt: `Catálogo actual, para reconocer nombres (categoría | modelo | capacidad):\n${catalogSummary}\n${supplierPrompt(supplier)}\n` +
      `Mensaje recibido el ${msg.received_at} de ${msg.sender_name ?? msg.sender ?? "desconocido"}:\n\n"""\n${msg.body}\n"""\n\n` +
      `Extraé todos los ítems con precio.`,
    schema: ParseSchema,
    usage: ctx.usage,
    // Listas largas (muchos modelos, formato con emojis) necesitan más lugar: con 6000 se cortaba
    // a mitad del JSON en catálogos grandes (Kondor) y la respuesta quedaba inválida por completo.
    maxTokens: 16000,
  });
}

function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/**
 * Price Reader (Lucas): SOLO lee las listas de proveedores y guarda lo que cada uno cotiza hoy.
 * No toca precios ni la app — compara y decide el Price Analyst (Martín) a las 11, cuando ya
 * llegaron las listas de todos los proveedores del día.
 */
export const priceReader: AgentModule = {
  id: "price-reader",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const { data: messages, error } = await ctx.db
      .from("supplier_messages")
      .select("id, source, sender, sender_name, received_at, body, supplier_id")
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
          `También podés pegar una lista a mano desde mi panel.\n\n## Para hoy\n- Nada que leer.`,
        summary: "en espera, sin listas nuevas",
        data: { messages: 0, quotes: 0 },
      };
    }

    const catalogSummary = await catalogNames(ctx.db);
    const today = todayArt();

    const supplierCache = new Map<string, SupplierRow | null>();
    async function supplierOf(id: string | null): Promise<SupplierRow | null> {
      if (!id) return null;
      if (!supplierCache.has(id)) {
        const { data } = await ctx.db.from("suppliers").select("id, phone, name, rules").eq("id", id).maybeSingle<SupplierRow>();
        supplierCache.set(id, data ?? null);
      }
      return supplierCache.get(id) ?? null;
    }

    const bySupplier = new Map<string, { name: string; items: number; skipped: number }>();
    let itemsTotal = 0;
    let quotesTotal = 0;

    for (const msg of messages) {
      const supplier = await supplierOf(msg.supplier_id);
      const supplierLabel = supplier?.name ?? supplier?.phone ?? msg.sender_name ?? "proveedor sin identificar";
      let parsed: ParsedList;
      try {
        parsed = await parseSupplierMessage(ctx, msg, catalogSummary, supplier);
      } catch (err) {
        ctx.log(`no pude parsear ${msg.id}: ${err instanceof Error ? err.message : err}`);
        await ctx.db.from("supplier_messages").update({ parsed_at: new Date().toISOString(), parse_json: { error: String(err) }, run_id: ctx.runId }).eq("id", msg.id);
        continue;
      }
      await ctx.db.from("supplier_messages").update({ parsed_at: new Date().toISOString(), parse_json: parsed, run_id: ctx.runId }).eq("id", msg.id);
      const discount = Number(supplier?.rules?.unit_discount_usd ?? 0) || 0;

      const stat = bySupplier.get(supplierLabel) ?? { name: supplierLabel, items: 0, skipped: 0 };
      stat.skipped += parsed.skipped.length;

      const rows: Record<string, unknown>[] = [];
      for (const item of parsed.items) {
        itemsTotal++;
        if (item.category === "other" || item.currency !== "USD" || item.condition !== "new" || item.confidence < 0.6) continue;
        const listed = Math.round(item.price);
        const cost = Math.max(0, listed - discount);
        rows.push({
          message_id: msg.id,
          supplier_id: msg.supplier_id,
          category: item.category as Category,
          model: item.model,
          capacity: item.capacity,
          cost_usd: cost,
          original_price_usd: listed,
          pricing_basis: item.pricing_basis,
          bulk_qty: item.pricing_basis === "bulk_min" ? item.bulk_qty : null,
          confidence: item.confidence,
          raw_line: item.raw_line,
          quote_date: today,
        });
      }
      if (rows.length) {
        await ctx.db.from("price_quotes").insert(rows);
        quotesTotal += rows.length;
      }
      stat.items += rows.length;
      bySupplier.set(supplierLabel, stat);
    }

    const lines: string[] = ["# Listas de proveedores", ""];
    lines.push(`Leí ${messages.length} ${messages.length === 1 ? "lista" : "listas"} con ${itemsTotal} ítems; guardé ${quotesTotal} cotizaciones para comparar.`);
    lines.push("", "## Por proveedor");
    for (const s of bySupplier.values()) lines.push(`- **${s.name}**: ${s.items} cotizaciones${s.skipped ? `, ${s.skipped} líneas que no entendí` : ""}`);
    lines.push("", "## Para hoy");
    lines.push("- Todavía no toqué ningún precio: eso lo hace Martín (Price Analyst) a las 11, cuando compara estas cotizaciones entre todos los proveedores del día y elige la más barata de cada producto.");

    return {
      markdown: lines.join("\n"),
      summary: `${quotesTotal} cotizaciones guardadas de ${bySupplier.size} ${bySupplier.size === 1 ? "proveedor" : "proveedores"}`,
      data: { messages: messages.length, items: itemsTotal, quotes: quotesTotal, by_supplier: [...bySupplier.values()] },
    };
  },
};
