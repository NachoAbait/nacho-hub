import type { AgentModule } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import { CATEGORY_LABEL, type Banner } from "@/lib/types";

const AGROSCAN_FEATURES = [
  "carga de pesadas y sanidad por WhatsApp, sin planillas",
  "pesar con el bastón de caravanas electrónicas aunque no haya señal en el campo",
  "sanidad y servicios (natural e IATF) registrados en el momento, no a la noche de memoria",
  "control de la tropa desde el celular, sin depender de la computadora de la oficina",
];

/**
 * Copy Writer (Facundo): escribe captions con los datos reales del día.
 * Para BNB usa las historias que ya armó Nico hoy (snapshot_json tiene modelo y precio exactos).
 * Para AgroScan, que todavía no cobra ni tiene catálogo, rota entre funcionalidades reales ya en producción.
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
        `Dos variantes (corta y completa) para Instagram, pensadas para un productor de la zona de Dolores.`;
      const markdown = await askText({
        agent: "copy-writer",
        role: "analyst",
        system: systemPrompt("copy-writer"),
        prompt,
        usage: ctx.usage,
        maxTokens: 1200,
      });
      return { markdown, summary: `captions sobre "${feature.slice(0, 40)}…"`, data: { feature } };
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
        data: {},
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
      `Escribí los captions para acompañar estas historias en el feed y en WhatsApp. Dos variantes (corta y completa) ` +
      `por cada categoría con historia nueva. Usá solo estos precios, no inventes ninguno.`;

    const markdown = await askText({
      agent: "copy-writer",
      role: "analyst",
      system: systemPrompt("copy-writer"),
      prompt,
      usage: ctx.usage,
      maxTokens: 2500,
    });

    return {
      markdown,
      summary: `captions para ${todays.length} ${todays.length === 1 ? "categoría" : "categorías"}`,
      data: { categories: todays.map((b) => b.category) },
    };
  },
};
