import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentModule } from "@/lib/agents/runtime";
import { askJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { listPendingSenders, saveDraftReply, type PendingSender } from "@/lib/suppliers";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

const DraftSchema = z.object({
  classification: z.enum(["rutinario", "venta_caliente", "derivar"]),
  note: z.string(),
  reply: z.string().nullable(),
});

interface CatalogRow {
  category: Category;
  model: string;
  capacity: string | null;
  price_usd: number;
}

async function catalogText(db: SupabaseClient): Promise<string> {
  const { data } = await db
    .from("products")
    .select("category, model, capacity, price_usd")
    .eq("is_active", true)
    .eq("context", "BNB")
    .order("category")
    .order("display_order")
    .returns<CatalogRow[]>();
  if (!data?.length) return "(no hay catálogo activo cargado: si preguntan precio, no inventes ninguno)";
  const byCategory = new Map<Category, string[]>();
  for (const p of data) {
    const list = byCategory.get(p.category) ?? [];
    list.push(`${p.model}${p.capacity ? ` ${p.capacity}` : ""}: US$ ${Number(p.price_usd)}`);
    byCategory.set(p.category, list);
  }
  return [...byCategory.entries()].map(([cat, items]) => `### ${CATEGORY_LABEL[cat]}\n${items.join("\n")}`).join("\n\n");
}

function needsDraft(p: PendingSender): boolean {
  if (p.kind !== "phone" || !p.last_body) return false;
  if (!p.draft_generated_at) return true;
  return new Date(p.draft_generated_at) < new Date(p.last_seen_at);
}

/**
 * DM Handler (Micaela): prepara un borrador de respuesta para cada consulta de cliente que entra
 * por el mismo WhatsApp de los proveedores (pending_senders). Nunca manda nada: solo clasifica y
 * redacta, y Nacho copia o corrige desde el panel de Lucas. Sin esto, cada consulta quedaba sin
 * ayuda hasta que Nacho la descartaba o la sumaba como proveedor por error.
 */
export const dmHandler: AgentModule = {
  id: "dm-handler",
  contexts: ["BNB"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const pending = (await listPendingSenders(ctx.db)).filter(needsDraft);
    if (!pending.length) {
      return { markdown: `# DM Handler · ${ctx.today}\n\nNo hay consultas nuevas sin borrador.`, summary: "sin consultas nuevas", data: {} };
    }

    const catalog = await catalogText(ctx.db);
    let hot = 0;
    let derivar = 0;
    let rutinario = 0;
    const lines: string[] = [];

    for (const p of pending) {
      const prompt =
        `Catálogo activo de BNB Store (único dato real para precio o disponibilidad):\n\n${catalog}\n\n` +
        `Mensaje de WhatsApp de un número que no es proveedor:\n"${p.last_body}"\n\n` +
        `Clasificalo y, si corresponde, redactá el borrador.`;
      const draft = await askJson({
        agent: "dm-handler",
        role: "analyst",
        system: systemPrompt("dm-handler"),
        prompt,
        schema: DraftSchema,
        usage: ctx.usage,
        maxTokens: 600,
      });
      await saveDraftReply(ctx.db, p.sender, draft);
      if (draft.classification === "venta_caliente") hot++;
      else if (draft.classification === "derivar") derivar++;
      else rutinario++;
      lines.push(`- **${p.sender_name ?? p.sender}** (${draft.classification}): ${draft.note}`);
    }

    const markdown =
      `# DM Handler · ${ctx.today}\n\n` +
      `Preparé ${pending.length} borrador${pending.length === 1 ? "" : "es"} de respuesta. Los ves, copiás o corregís ` +
      `desde el panel de Lucas (Proveedores → ¿te escribió alguien nuevo?). No mandé nada.\n\n` +
      (hot ? `**${hot} ${hot === 1 ? "venta caliente" : "ventas calientes"}: revisalas ya.**\n\n` : "") +
      lines.join("\n");

    return {
      markdown,
      summary: `${pending.length} borrador${pending.length === 1 ? "" : "es"} (${hot} caliente${hot === 1 ? "" : "s"}, ${derivar} a derivar, ${rutinario} rutinario${rutinario === 1 ? "" : "s"})`,
      data: { hot, derivar, rutinario },
    };
  },
};
