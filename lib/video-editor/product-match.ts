import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeModel } from "@/lib/nexios";
import { wordsMatch } from "@/lib/agents/catalog-match";

export interface OverlayMatch {
  /** Lo que se guarda en video_clips.product_hint. */
  hint: string;
  /** Texto bajo la caja en el video. */
  label: string;
  /** URL pública de la imagen a mostrar en la caja flotante. */
  imageUrl: string;
}

/**
 * Accesorios con placeholder ya generado y subido a Supabase Storage (bucket "heroes", carpeta
 * accesorios/ — ver tarea: son renders de IA low-res 200x200, provisorios hasta tener fotos reales).
 * Match por palabra clave en el nombre del archivo, sin sensibilidad a mayúsculas.
 */
const ACCESSORY_KEYWORDS: { pattern: RegExp; hint: string; label: string; storagePath: string }[] = [
  { pattern: /cargador/i, hint: "cargador", label: "Cargador", storagePath: "accesorios/cargador__generico.png" },
  { pattern: /blindad/i, hint: "blindado", label: "Vidrio blindado", storagePath: "accesorios/blindado__generico.png" },
  { pattern: /garant/i, hint: "garantia", label: "Garantía BNB", storagePath: "accesorios/garantia__sello.png" },
];

/**
 * Busca qué producto mostrar en la caja flotante a partir del nombre del archivo que subió Nacho
 * (ej. "iphone17probarato.mp4", "cargador_tipo_c.mov"). Primero prueba los accesorios conocidos
 * (match exacto de palabra clave, sin ambigüedad posible); si no matchea ninguno, busca contra los
 * modelos de teléfono activos del catálogo del hub con la misma tolerancia a variantes de ortografía
 * que ya usa el matching de cotizaciones (wordsMatch) — no vale la pena un matcher más sofisticado
 * para esto: el nombre del archivo lo escribe Nacho a mano, no un proveedor con miles de variantes.
 */
export async function matchOverlay(db: SupabaseClient, fileName: string): Promise<OverlayMatch | null> {
  const base = fileName.replace(/\.[^./]+$/, "");

  for (const kw of ACCESSORY_KEYWORDS) {
    if (kw.pattern.test(base)) {
      const { data } = db.storage.from("heroes").getPublicUrl(kw.storagePath);
      return { hint: kw.hint, label: kw.label, imageUrl: data.publicUrl };
    }
  }

  const fileTokens = normalizeModel(base).split(/\s+/).filter(Boolean);
  if (fileTokens.length === 0) return null;

  const { data: products } = await db
    .from("products")
    .select("model, hero_image_url")
    .eq("is_active", true)
    .not("hero_image_url", "is", null)
    .returns<{ model: string; hero_image_url: string }[]>();

  for (const p of products ?? []) {
    const modelTokens = normalizeModel(p.model).split(/\s+/).filter(Boolean);
    if (modelTokens.length === 0) continue;
    const allTokensFound = modelTokens.every((mt) => fileTokens.some((ft) => ft === mt || wordsMatch(ft, mt)));
    if (allTokensFound) return { hint: p.model, label: p.model, imageUrl: p.hero_image_url };
  }

  return null;
}
