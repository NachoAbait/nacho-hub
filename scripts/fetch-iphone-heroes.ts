/**
 * Baja un render oficial de Apple (un color por modelo, elegido para que se distinga contra un
 * fondo oscuro) para cada iPhone activo en products, le recorta el fondo y lo sube al bucket
 * "heroes", y setea products.hero_image_url:
 *   npx tsx --env-file=.env.local scripts/fetch-iphone-heroes.ts
 */
import sharp from "sharp";
import { supabaseAdmin } from "../lib/supabase";

/** Algunos renders del CDN de Apple ya traen partes transparentes de fábrica (la "tarjeta" del
 * estudio no ocupa el lienzo entero) Y el resto del fondo con un degradé sutil, no un color plano.
 * Flood-fill desde el borde con dos reglas: contra el VECINO (tolera el degradé paso a paso, se
 * frena en el contorno del teléfono) y contra un color de referencia GLOBAL (el primer píxel
 * opaco que encuentra en el borde — nunca la esquina sola, que puede ser una de las partes ya
 * transparentes). Al expandir desde un píxel YA transparente no hay vecino válido con qué
 * comparar, así que ahí solo se exige la regla global. No hace nada si la imagen ya era 100%
 * transparente. */
export async function cutoutBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const idx = (x: number, y: number) => (y * width + x) * channels;
  const LOCAL_STEP = 20;
  const GLOBAL_CAP = 60;
  let cr = 245, cg = 245, cb = 247;
  findRef: for (let x = 0; x < width; x++) {
    const i = idx(x, 0);
    if (data[i + 3] >= 10) { cr = data[i]; cg = data[i + 1]; cb = data[i + 2]; break findRef; }
  }
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const propagate = (x: number, y: number, wasTransparent: boolean, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    const i = idx(x, y);
    const a = data[i + 3];
    if (a < 10) { visited[p] = 1; stack.push(x, y); return; }
    const gr = data[i] - cr, gg = data[i + 1] - cg, gb = data[i + 2] - cb;
    if (Math.sqrt(gr * gr + gg * gg + gb * gb) >= GLOBAL_CAP) return;
    if (!wasTransparent) {
      const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= LOCAL_STEP) return;
    }
    visited[p] = 1;
    stack.push(x, y);
  };
  const seedBorder = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) { seedBorder(x, 0); seedBorder(x, height - 1); }
  for (let y = 0; y < height; y++) { seedBorder(0, y); seedBorder(width - 1, y); }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const i = idx(x, y);
    const wasTransparent = data[i + 3] < 10;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i + 3] = 0;
    propagate(x + 1, y, wasTransparent, r, g, b); propagate(x - 1, y, wasTransparent, r, g, b);
    propagate(x, y + 1, wasTransparent, r, g, b); propagate(x, y - 1, wasTransparent, r, g, b);
  }
  // Las fotos "legado" (15/16/17 Pro Max) traían mucho margen vacío alrededor del teléfono dentro
  // del lienzo de 1400x1660 — una vez transparente, ese margen hacía que el teléfono se viera
  // chiquito en la card (contain escala según el tamaño de la imagen entera, no del sujeto). Recorta
  // al borde real de lo que quedó opaco, así el teléfono ocupa todo el alto disponible en la card.
  return sharp(data, { raw: { width, height, channels } }).trim().png().toBuffer();
}

const CDN = "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is";

function legado(fam: string, fecha: string, size: string, colores: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of colores) out[c] = `${fam}-finish-select-${fecha}-${size}-${c}`;
  return out;
}
function nuevo(fam: string, fecha: string, colores: string[], sufijo = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of colores) out[c] = `${fam}-finish-select-${c}-${fecha}${sufijo}`;
  return out;
}

// Colores reordenados a propósito: el PRIMERO de cada lista es el que se usa, y elegido para que
// se distinga bien contra un fondo oscuro (nada de negro-sobre-negro) y, de paso, para que no sea
// un tono casi igual al fondo claro del estudio de Apple (plata/blanco ahí sí cuesta recortar).
const TITANIOS = ["naturaltitanium", "deserttitanium", "blacktitanium", "whitetitanium"];
const PRO17 = ["cosmicorange", "deepblue", "silver"];

// Mismas claves que usa products.model (ver lib/designer/sync.ts displayModel).
const CATALOGO: Record<string, Record<string, string>> = {
  "iPhone 15": legado("iphone-15", "202309", "6-1inch", ["yellow", "blue", "green", "pink", "black"]),
  "iPhone 16": legado("iphone-16", "202409", "6-1inch", ["ultramarine", "teal", "pink", "white", "black"]),
  "iPhone 16e": { white: "iphone-16e-finish-select-202502-white", black: "iphone-16e-finish-select-202502-black" },
  "iPhone 16 Pro Max": legado("iphone-16-pro", "202409", "6-9inch", TITANIOS),
  "iPhone 17": nuevo("iphone-17", "202509", ["lavender", "sage", "mistblue", "white", "black"], "_GEO_US"),
  "iPhone 17 Air": nuevo("iphone-air", "202509", ["lightgold", "skyblue", "cloudwhite", "spaceblack"]),
  "iPhone 17 Pro": legado("iphone-17-pro", "202509", "6-3inch", PRO17),
  "iPhone 17 Pro Max": legado("iphone-17-pro", "202509", "6-9inch", PRO17),
  "iPhone 17e": nuevo("iphone-17e", "202603", ["softpink", "white", "black"]),
  "iPhone 18 Pro": nuevo("iphone-18-pro", "202609", ["burgundy", "glacier", "silver", "black"]),
  "iPhone 18 Pro Max": nuevo("iphone-18-pro-max", "202609", ["glacier", "burgundy", "silver", "black"]),
  "iPhone Duo": nuevo("iphone-duo", "202609", ["star-white", "night-sky"]),
};

function slugify(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const db = supabaseAdmin();
  const { data: products, error } = await db
    .from("products")
    .select("model")
    .eq("category", "iphone")
    .eq("is_active", true);
  if (error) throw error;
  const models = [...new Set((products ?? []).map((p) => p.model as string))];
  console.log("modelos activos:", models);

  for (const model of models) {
    const colors = CATALOGO[model];
    if (!colors) {
      console.log(`✗ sin mapeo CDN para "${model}"`);
      continue;
    }
    const [color, assetName] = Object.entries(colors)[0];
    const url = `${CDN}/${assetName}?wid=1400&hei=1660&fmt=png-alpha`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`✗ ${model} (${color}): HTTP ${res.status}`);
      continue;
    }
    const rawBuf = Buffer.from(await res.arrayBuffer());
    if (rawBuf.length < 10_000) {
      console.log(`✗ ${model} (${color}): respuesta demasiado chica (${rawBuf.length}b), probablemente no existe`);
      continue;
    }
    const buf = await cutoutBackground(rawBuf);
    const path = `iphone/${slugify(model)}.png`;
    const { error: upErr } = await db.storage.from("heroes").upload(path, buf, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.log(`✗ ${model}: error subiendo — ${upErr.message}`);
      continue;
    }
    const heroUrl = db.storage.from("heroes").getPublicUrl(path).data.publicUrl;
    const { error: updErr } = await db.from("products").update({ hero_image_url: heroUrl }).eq("category", "iphone").eq("model", model);
    if (updErr) {
      console.log(`✗ ${model}: error guardando hero_image_url — ${updErr.message}`);
      continue;
    }
    console.log(`✓ ${model} (${color}) → ${heroUrl}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
