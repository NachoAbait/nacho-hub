/**
 * Baja un render oficial de Apple (un color por modelo, elegido para que se distinga contra un
 * fondo oscuro) para cada iPad activo en products, le recorta el fondo y lo sube al bucket
 * "heroes", y setea products.hero_image_url:
 *   npx tsx --env-file=.env.local scripts/fetch-ipad-heroes.ts
 */
import { supabaseAdmin } from "../lib/supabase";
import { cutoutBackground } from "../lib/designer/cutout";

const CDN = "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is";

/** Un asset por modelo (no varía por capacidad): colores elegidos por contraste contra fondo
 * oscuro, nunca plata/negro apagado. Nombres sacados de las páginas de compra oficiales de Apple. */
const CATALOGO: Record<string, string> = {
  iPad: "ipad-finish-select-202503-blue",
  "iPad Air": "ipad-air-finish-select-gallery-202405-11inch-blue-wifi",
  "iPad Pro": "ipad-pro-finish-select-202405-11inch-silver-glossy-wifi",
};

function slugify(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const db = supabaseAdmin();
  const { data: products, error } = await db
    .from("products")
    .select("model")
    .eq("category", "ipad")
    .eq("is_active", true);
  if (error) throw error;
  const models = [...new Set((products ?? []).map((p) => p.model as string))];
  console.log("modelos activos:", models);

  for (const model of models) {
    const assetName = CATALOGO[model];
    if (!assetName) {
      console.log(`✗ sin mapeo CDN para "${model}"`);
      continue;
    }
    const url = `${CDN}/${assetName}?wid=1200&hei=1200&fmt=png-alpha`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`✗ ${model}: HTTP ${res.status}`);
      continue;
    }
    const rawBuf = Buffer.from(await res.arrayBuffer());
    if (rawBuf.length < 10_000) {
      console.log(`✗ ${model}: respuesta demasiado chica (${rawBuf.length}b), probablemente no existe`);
      continue;
    }
    const buf = await cutoutBackground(rawBuf);
    const path = `ipad/${slugify(model)}.png`;
    const { error: upErr } = await db.storage.from("heroes").upload(path, buf, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.log(`✗ ${model}: error subiendo — ${upErr.message}`);
      continue;
    }
    const heroUrl = db.storage.from("heroes").getPublicUrl(path).data.publicUrl;
    const { error: updErr } = await db.from("products").update({ hero_image_url: heroUrl }).eq("category", "ipad").eq("model", model);
    if (updErr) {
      console.log(`✗ ${model}: error guardando hero_image_url — ${updErr.message}`);
      continue;
    }
    console.log(`✓ ${model} → ${heroUrl}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
