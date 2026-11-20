import type { CatalogProduct } from "@/lib/video-editor/product-match";

/**
 * Modelos que Nacho NOMBRA en sus videos (para recomendar o para decir que no los compres) pero que
 * ya no vende — por eso no están en `products` y nunca van a tener `hero_image_url` ahí. El catálogo
 * de "qué muestro en el video" es más amplio que el catálogo de "qué vendo", así que esta lista vive
 * aparte en vez de forzar filas falsas en `products`.
 *
 * Fotos reales de Apple (CDN público, cutout ya aplicado) salvo que se note lo contrario. Faltan
 * iPhone 13 / 13 mini / 13 Pro / 13 Pro Max / 14 Plus: el CDN de Apple ya no sirve esos assets con
 * ningún patrón de URL probado (2026-11-20) y tampoco están en los renders de NexiOS — hasta que
 * Nacho confirme si quiere un render generado por IA para esos, quedan sin foto (ver warning que
 * tira buildContentTimeline en lib/agents/video-editor.ts cuando los nombra).
 */
export const EXTRA_MODEL_IMAGES: Record<string, string> = {
  "iPhone 14": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-legacy.png",
  "iPhone 14 Pro": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-pro-legacy.png",
  "iPhone 14 Pro Max": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-pro-max-legacy.png",
};

/** Catálogo activo (lo que vende) + esta biblioteca extra (lo que nombra pero no vende) — el activo
 * gana si un mismo modelo aparece en los dos (su foto puede estar más actualizada). */
export function withExtraModels(activeCatalog: CatalogProduct[]): CatalogProduct[] {
  const known = new Set(activeCatalog.map((c) => c.model));
  const extras = Object.entries(EXTRA_MODEL_IMAGES)
    .filter(([model]) => !known.has(model))
    .map(([model, hero_image_url]) => ({ model, hero_image_url }));
  return [...activeCatalog, ...extras];
}
