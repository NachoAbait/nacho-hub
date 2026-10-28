import type { AgentModule } from "@/lib/agents/runtime";
import { generateAllBanners } from "@/lib/designer/generate";
import { syncProductsFromNexios } from "@/lib/designer/sync";
import { CATEGORY_LABEL } from "@/lib/types";

/**
 * Designer (Nico): sincroniza el catálogo desde NexiOS y arma el banner de cada categoría.
 * No usa Claude: es un pipeline determinista (HTML + Playwright).
 */
export const designer: AgentModule = {
  id: "designer",
  contexts: ["BNB"],
  requiredEnv: ["NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    const sync = await syncProductsFromNexios(ctx.db);
    ctx.log(sync.synced ? `catálogo sincronizado: ${sync.upserted} productos, ${sync.deactivated} dados de baja` : `sin sync: ${sync.reason}`);

    const results = await generateAllBanners();
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok && r.products > 0);
    const empty = results.filter((r) => r.products === 0);

    const lines: string[] = [];
    lines.push(`# Banners del día`);
    lines.push("");
    lines.push(
      sync.synced
        ? `Catálogo tomado de NexiOS: ${sync.upserted} productos visibles.`
        : `Catálogo del hub (sin conexión a NexiOS: ${sync.reason}).`,
    );
    lines.push("");
    for (const r of ok) lines.push(`- **${CATEGORY_LABEL[r.category]}**: ${r.products} productos → [ver PNG](${r.banner!.image_url})`);
    if (failed.length) {
      lines.push("");
      lines.push("Fallaron:");
      for (const r of failed) lines.push(`- ${CATEGORY_LABEL[r.category]}: ${r.error}`);
    }
    if (empty.length) {
      lines.push("");
      lines.push(`Sin productos activos: ${empty.map((r) => CATEGORY_LABEL[r.category]).join(", ")}.`);
    }

    return {
      markdown: lines.join("\n"),
      summary: `${ok.length} banners generados${failed.length ? `, ${failed.length} con error` : ""}`,
      data: { sync, banners: results.map((r) => ({ category: r.category, ok: r.ok, url: r.banner?.image_url ?? null, products: r.products, error: r.error ?? null })) },
    };
  },
};
