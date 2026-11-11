/**
 * Baja un render oficial de Apple para cada modelo de AirPods activo en products, le recorta el
 * fondo y lo sube al bucket "heroes", y setea products.hero_image_url:
 *   npx tsx --env-file=.env.local scripts/fetch-airpods-heroes.ts
 */
import { supabaseAdmin } from "../lib/supabase";
import { cutoutBackground, trimOnly } from "../lib/designer/cutout";

const CDN = "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is";

// Mismas claves que usa products.model. AirPods Max en "purple" (único modelo con color a
// elegir): se evita negro/plata/blanco para que se distinga contra el fondo oscuro del banner.
const CATALOGO: Record<string, string> = {
  "AirPods 4": "airpods-4-select-202409_FV1",
  "AirPods 4 Noise Cancelling": "airpods-4-anc-select-202409_FV1",
  "AirPods 5": "airpods-5-select-202609_FV1",
  "AirPods 5 Wireless Charging Case": "airpods-5-wcc-select-202609_FV1",
  "AirPods Pro 3": "airpods-pro-3-hero-select-202509",
  "AirPods Max 2": "airpods-max-select-202409-purple_FV1",
};

/** Todos blancos sobre blanco salvo Max (que tiene color): ahí el flood-fill de cutoutBackground
 * no puede diferenciar producto de fondo y termina perforando el cuerpo — ver trimOnly(). */
const WHITE_ON_WHITE = new Set([
  "AirPods 4",
  "AirPods 4 Noise Cancelling",
  "AirPods 5",
  "AirPods 5 Wireless Charging Case",
  "AirPods Pro 3",
]);

function slugify(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const db = supabaseAdmin();
  const { data: products, error } = await db
    .from("products")
    .select("model")
    .eq("category", "airpods")
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
    const buf = WHITE_ON_WHITE.has(model) ? await trimOnly(rawBuf) : await cutoutBackground(rawBuf);
    const path = `airpods/${slugify(model)}.png`;
    const { error: upErr } = await db.storage.from("heroes").upload(path, buf, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.log(`✗ ${model}: error subiendo — ${upErr.message}`);
      continue;
    }
    const heroUrl = db.storage.from("heroes").getPublicUrl(path).data.publicUrl;
    const { error: updErr } = await db.from("products").update({ hero_image_url: heroUrl }).eq("category", "airpods").eq("model", model);
    if (updErr) {
      console.log(`✗ ${model}: error guardando hero_image_url — ${updErr.message}`);
      continue;
    }
    console.log(`✓ ${model} → ${heroUrl}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
