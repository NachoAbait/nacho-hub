import type { CatalogProduct } from "@/lib/video-editor/product-match";

/**
 * Modelos que Nacho NOMBRA en sus videos (para recomendar o para decir que no los compres) pero que
 * ya no vende — por eso no están en `products` y nunca van a tener `hero_image_url` ahí. El catálogo
 * de "qué muestro en el video" es más amplio que el catálogo de "qué vendo", así que esta lista vive
 * aparte en vez de forzar filas falsas en `products`.
 *
 * Fotos reales de Apple (CDN público, cutout ya aplicado) salvo que se note lo contrario. Faltan
 * 13 mini / 14 Plus: el CDN de Apple ya no sirve esos assets con ningún patrón de URL probado
 * (2026-11-20) y tampoco están en los renders de NexiOS — pendientes de un render por IA si Nacho
 * los llega a nombrar (mismo camino que "iPhone 13" abajo).
 *
 * "iPhone 13" / "iPhone 13 Pro" / "iPhone 13 Pro Max": SÍ generados por IA (Canva), no son fotos
 * reales — Apple no las sirve más y no aparecieron en ningún lado. Los dos últimos se generaron el
 * 25-11-2026 porque el video "Que no te tomen el pelo" los nombra explícitamente (antes solo estaba
 * "iPhone 13" simple). Reemplazar si en algún momento se consigue una foto real o un export de mejor
 * resolución.
 */
export const EXTRA_MODEL_IMAGES: Record<string, string> = {
  "iPhone 14": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-legacy.png",
  "iPhone 14 Pro": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-pro-legacy.png",
  "iPhone 14 Pro Max": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-14-pro-max-legacy.png",
  "iPhone 13": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-13-ai.png",
  "iPhone 13 Pro": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-13-pro-ai.png",
  "iPhone 13 Pro Max": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-13-pro-max-ai.png",
  "iPhone 15 Pro": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-15-pro-ai.png",
  "iPhone 15 Pro Max": "https://djrsijxkjcwqrlgnlcbc.supabase.co/storage/v1/object/public/heroes/iphone/iphone-15-pro-max-ai.png",
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
