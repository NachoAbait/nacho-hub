/**
 * Baja un render oficial de Apple (un color, elegido para que se distinga contra un fondo oscuro)
 * para cada MacBook activo en products, le recorta el fondo y lo sube al bucket "heroes", y setea
 * products.hero_image_url. A diferencia del script de iPhone/iPad, acá se resuelve POR FILA (no
 * por modelo): "MacBook Air" y "MacBook Pro" existen en más de un tamaño de pantalla (13"/15",
 * 14"/16") y cada tamaño usa un asset de Apple distinto.
 *   npx tsx --env-file=.env.local scripts/fetch-macbook-heroes.ts
 */
import { supabaseAdmin } from "../lib/supabase";
import { cutoutBackground } from "../lib/designer/cutout";
import type { ProductAttributes } from "../lib/types";

const CDN = "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is";

/** "MacBook NEO" no es un MacBook real (chip A18 Pro no existe en ningún Mac) — es un clon que
 * vende BNB con nombre comercial propio, así que no tiene render de Apple: queda sin mapeo. */
function resolveAsset(model: string, attrs: ProductAttributes | null): string | null {
  const screen = attrs?.screen ?? "";
  if (model === "MacBook Air") {
    return screen.includes("15") ? "mba15-skyblue-select-202503" : "mba13-skyblue-select-202503";
  }
  if (model === "MacBook Pro") {
    return screen.includes("16") ? "mbp16-silver-select-202410" : "mbp14-silver-select-202410";
  }
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const db = supabaseAdmin();
  const { data: products, error } = await db
    .from("products")
    .select("id, model, attributes")
    .eq("category", "macbook")
    .eq("is_active", true);
  if (error) throw error;

  const cache = new Map<string, Buffer>();

  for (const p of products ?? []) {
    const model = p.model as string;
    const attrs = p.attributes as ProductAttributes | null;
    const assetName = resolveAsset(model, attrs);
    if (!assetName) {
      console.log(`✗ sin mapeo CDN para "${model}" (${attrs?.screen ?? "?"})`);
      continue;
    }
    let buf = cache.get(assetName);
    if (!buf) {
      const url = `${CDN}/${assetName}?wid=1200&hei=1200&fmt=png-alpha`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`✗ ${model} (${attrs?.screen}): HTTP ${res.status}`);
        continue;
      }
      const rawBuf = Buffer.from(await res.arrayBuffer());
      if (rawBuf.length < 10_000) {
        console.log(`✗ ${model} (${attrs?.screen}): respuesta demasiado chica (${rawBuf.length}b)`);
        continue;
      }
      buf = await cutoutBackground(rawBuf);
      cache.set(assetName, buf);
    }
    const path = `macbook/${slugify(model)}-${slugify(attrs?.screen ?? "x")}.png`;
    const { error: upErr } = await db.storage.from("heroes").upload(path, buf, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.log(`✗ ${model}: error subiendo — ${upErr.message}`);
      continue;
    }
    const heroUrl = db.storage.from("heroes").getPublicUrl(path).data.publicUrl;
    const { error: updErr } = await db.from("products").update({ hero_image_url: heroUrl }).eq("id", p.id as string);
    if (updErr) {
      console.log(`✗ ${model}: error guardando hero_image_url — ${updErr.message}`);
      continue;
    }
    console.log(`✓ ${model} (${attrs?.screen}) → ${heroUrl}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
