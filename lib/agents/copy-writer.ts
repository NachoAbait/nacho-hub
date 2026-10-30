import { z } from "zod";
import type { AgentModule } from "@/lib/agents/runtime";
import { askJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { CATEGORY_LABEL, type Banner } from "@/lib/types";

const AGROSCAN_FEATURES = [
  "carga de pesadas y sanidad por WhatsApp, sin planillas",
  "pesar con el bastón de caravanas electrónicas aunque no haya señal en el campo",
  "sanidad y servicios (natural e IATF) registrados en el momento, no a la noche de memoria",
  "control de la tropa desde el celular, sin depender de la computadora de la oficina",
];

const VariantSchema = z.object({ label: z.enum(["corta", "completa"]), text: z.string(), hashtags: z.array(z.string()) });
const CaptionSetSchema = z.object({ title: z.string(), variants: z.array(VariantSchema).length(2) });
const CaptionsSchema = z.object({ sets: z.array(CaptionSetSchema) });
export type CaptionSet = z.infer<typeof CaptionSetSchema>;

function toMarkdown(sets: CaptionSet[]): string {
  return sets
    .map((s) => `## ${s.title}\n\n` + s.variants.map((v) => `### ${v.label}\n\n${v.text}\n\n${v.hashtags.map((h) => `#${h}`).join(" ")}`).join("\n\n"))
    .join("\n\n---\n\n");
}

/**
 * Copy Writer (Facundo): escribe captions con los datos reales del día.
 * Para BNB usa las historias que ya armó Nico hoy (snapshot_json tiene modelo y precio exactos).
 * Para AgroScan, que todavía no cobra ni tiene catálogo, rota entre funcionalidades reales ya en producción.
 * Devuelve JSON estructurado para que el panel muestre cada caption como una tarjeta con botón de copiar.
 */
export const copyWriter: AgentModule = {
  id: "copy-writer",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    if (ctx.context === "AgroScan") {
      const dayIndex = new Date(`${ctx.today}T12:00:00-03:00`).getDate() % AGROSCAN_FEATURES.length;
      const feature = AGROSCAN_FEATURES[dayIndex];
      const prompt =
        `Contexto: AgroScan. Hoy es ${ctx.today}.\n\n` +
        `No hay catálogo ni precios para publicar (AgroScan todavía no cobra). ` +
        `Escribí captions sobre esta funcionalidad real, ya en producción: "${feature}".\n\n` +
        `Un solo set de captions (title: el nombre corto de la funcionalidad), con las dos variantes (corta y completa) ` +
        `para Instagram, pensadas para un productor de la zona de Dolores.`;
      const result = await askJson({
        agent: "copy-writer",
        role: "analyst",
        system: systemPrompt("copy-writer"),
        prompt,
        schema: CaptionsSchema,
        usage: ctx.usage,
        maxTokens: 1200,
      });
      return {
        markdown: toMarkdown(result.sets),
        summary: `captions sobre "${feature.slice(0, 40)}…"`,
        data: { feature, sets: result.sets },
      };
    }

    const since = `${ctx.today}T00:00:00-03:00`;
    const { data: banners } = await ctx.db
      .from("banners")
      .select("category, generated_at, snapshot_json")
      .gte("generated_at", since)
      .order("generated_at", { ascending: false })
      .returns<Pick<Banner, "category" | "generated_at" | "snapshot_json">[]>();

    const seenCategory = new Set<string>();
    const todays = (banners ?? []).filter((b) => (seenCategory.has(b.category) ? false : (seenCategory.add(b.category), true)));

    if (!todays.length) {
      return {
        markdown: `# Copy del día · BNB\n\nTodavía no hay historias armadas hoy (Nico no corrió o no tiene productos activos). No tengo datos reales para escribir captions sin inventar precios.`,
        summary: "sin historias hoy, no escribió nada",
        data: { sets: [] },
      };
    }

    const productsText = todays
      .map((b) => {
        const lines = b.snapshot_json.products.map((p) => `  - ${p.model}${p.capacity ? ` ${p.capacity}` : ""}: US$ ${p.price_usd}`);
        return `### ${CATEGORY_LABEL[b.category]}\n${lines.join("\n")}`;
      })
      .join("\n\n");

    const prompt =
      `Contexto: BNB. Hoy es ${ctx.today}.\n\n` +
      `Estas son las historias que Nico ya armó hoy, con los productos y precios exactos que llevan:\n\n${productsText}\n\n` +
      `Escribí los captions para acompañar estas historias en el feed y en WhatsApp. Un set por categoría con historia ` +
      `nueva (title: el nombre de la categoría), cada uno con las dos variantes (corta y completa). Usá solo estos ` +
      `precios, no inventes ninguno.`;

    const result = await askJson({
      agent: "copy-writer",
      role: "analyst",
      system: systemPrompt("copy-writer"),
      prompt,
      schema: CaptionsSchema,
      usage: ctx.usage,
      maxTokens: 2500,
    });

    return {
      markdown: toMarkdown(result.sets),
      summary: `captions para ${todays.length} ${todays.length === 1 ? "categoría" : "categorías"}`,
      data: { categories: todays.map((b) => b.category), sets: result.sets },
    };
  },
};
