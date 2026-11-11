/**
 * Importa renders que NexiOS ya tiene aprobados y en uso (public/renders en el repo de NexiOS,
 * "resellerapp" en esta máquina) para categorías donde todavía no teníamos foto: Samsung, Apple
 * Watch y MacBook NEO. Ya vienen recortados a transparente, no hace falta cutout.
 *
 * Necesita el checkout local de NexiOS al lado (NEXIOS_RENDERS_DIR) — por eso es un script manual,
 * no corre en Vercel ni en ningún cron. Si se mueve el checkout, pasale la ruta por env var:
 *   NEXIOS_RENDERS_DIR=/ruta/a/resellerapp/public/renders npx tsx --env-file=.env.local scripts/import-nexios-renders.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "../lib/supabase";

const RENDERS_DIR =
  process.env.NEXIOS_RENDERS_DIR ?? path.join(process.env.HOME ?? "", "resellerapp/public/renders");

interface Entry {
  category: "samsung" | "watch" | "macbook";
  model: string;
  file: string;
}

// Un color por modelo, elegido por contraste contra el fondo oscuro del banner (nunca negro/plata
// apagado) — mismo criterio que el resto de los scripts de heroes. Apple Watch Series 11 y Ultra 3
// reusan la foto de Series 12 / Ultra 4: es el mismo alias que ya usa NexiOS (src/lib/product-renders.ts)
// porque la carcasa no cambia de año a año, nada más el chip adentro.
const ENTRIES: Entry[] = [
  { category: "samsung", model: "Galaxy S25 FE", file: "galaxy-s25-fe__navy.webp" },
  { category: "samsung", model: "Galaxy S25 Ultra", file: "galaxy-s25-ultra__titaniumsilverblue.webp" },
  { category: "samsung", model: "Galaxy S26", file: "galaxy-s26__skyblue.webp" },
  { category: "samsung", model: "Galaxy S26 Ultra", file: "galaxy-s26-ultra__pinkgold.webp" },
  { category: "watch", model: "Apple Watch SE 3", file: "apple-watch-se-3__default.webp" },
  { category: "watch", model: "Apple Watch Series 11", file: "apple-watch-series-12__default.webp" },
  { category: "watch", model: "Apple Watch Series 12", file: "apple-watch-series-12__default.webp" },
  { category: "watch", model: "Apple Watch Ultra 3", file: "apple-watch-ultra-4__default.webp" },
  { category: "watch", model: "Apple Watch Ultra 4", file: "apple-watch-ultra-4__default.webp" },
  { category: "macbook", model: "MacBook NEO", file: "macbook-neo__citrus.webp" },
];

function slugify(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const db = supabaseAdmin();
  const cache = new Map<string, Buffer>();

  for (const { category, model, file } of ENTRIES) {
    let buf = cache.get(file);
    if (!buf) {
      try {
        buf = readFileSync(path.join(RENDERS_DIR, file));
      } catch (e) {
        console.log(`✗ ${model}: no se pudo leer ${file} — ${(e as Error).message}`);
        continue;
      }
      cache.set(file, buf);
    }
    const storagePath = `${category}/${slugify(model)}.webp`;
    const { error: upErr } = await db.storage
      .from("heroes")
      .upload(storagePath, buf, { contentType: "image/webp", upsert: true });
    if (upErr) {
      console.log(`✗ ${model}: error subiendo — ${upErr.message}`);
      continue;
    }
    const heroUrl = db.storage.from("heroes").getPublicUrl(storagePath).data.publicUrl;
    const { error: updErr } = await db
      .from("products")
      .update({ hero_image_url: heroUrl })
      .eq("category", category)
      .eq("model", model);
    if (updErr) {
      console.log(`✗ ${model}: error guardando hero_image_url — ${updErr.message}`);
      continue;
    }
    console.log(`✓ ${model} → ${heroUrl}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
