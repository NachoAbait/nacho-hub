/**
 * Sincroniza el catálogo real de NexiOS al hub y genera las historias de todas las categorías:
 *   npx tsx --env-file=.env.local scripts/sync-and-generate.tsx [--no-banners]
 */
import { supabaseAdmin } from "../lib/supabase";
import { syncProductsFromNexios } from "../lib/designer/sync";
import { generateAllBanners } from "../lib/designer/generate";

async function main() {
  const db = supabaseAdmin();
  const sync = await syncProductsFromNexios(db);
  console.log("sync:", sync);
  const { data } = await db.from("products").select("category, source, is_active");
  const counts: Record<string, number> = {};
  for (const p of data ?? []) counts[`${p.category}/${p.source}/${p.is_active ? "on" : "off"}`] = (counts[`${p.category}/${p.source}/${p.is_active ? "on" : "off"}`] ?? 0) + 1;
  console.log(counts);
  if (process.argv.includes("--no-banners")) return;
  const res = await generateAllBanners();
  for (const r of res) console.log(r.category, r.ok ? r.banner?.image_url : `ERROR ${r.error}`, `(${r.products} productos)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
