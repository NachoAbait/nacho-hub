import type { ReactElement } from "react";
// "react-dom/server" está bloqueado por Next en la capa server; la variante .browser sí se permite
import { renderToStaticMarkup } from "react-dom/server.browser";
import { supabaseAdmin } from "@/lib/supabase";
import type { Banner, BannerSnapshot, Category, Product } from "@/lib/types";
import { renderHtmlToPng, type RenderSize } from "@/lib/designer/render";
import { IphoneBanner, IPHONE_BANNER_SIZE, IPHONE_TEMPLATE_VERSION } from "@/components/banners/iphone";

type SnapshotProduct = BannerSnapshot["products"][number];

interface BannerTemplate {
  version: number;
  size: RenderSize;
  /** Cuántos productos entran en el diseño. */
  maxProducts: number;
  render: (products: SnapshotProduct[], dateLabel: string) => ReactElement;
}

/** Un template por categoría. Las que faltan todavía no se pueden generar. */
const TEMPLATES: Partial<Record<Category, BannerTemplate>> = {
  iphone: {
    version: IPHONE_TEMPLATE_VERSION,
    size: IPHONE_BANNER_SIZE,
    maxProducts: 6,
    render: (products, dateLabel) => <IphoneBanner products={products} dateLabel={dateLabel} />,
  },
};

export function hasTemplate(category: Category): boolean {
  return Boolean(TEMPLATES[category]);
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export class DesignerError extends Error {
  constructor(message: string, public status: number = 500) {
    super(message);
  }
}

/**
 * Pipeline completo: productos activos → HTML → PNG → Storage → row en banners.
 * Lo usan el route handler y la server action del dashboard.
 */
export async function generateBanner(category: Category): Promise<Banner> {
  const template = TEMPLATES[category];
  if (!template) throw new DesignerError(`Todavía no hay template para "${category}"`, 400);

  const db = supabaseAdmin();

  const { data: products, error: productsError } = await db
    .from("products")
    .select("id, model, capacity, price_usd, hero_image_url")
    .eq("category", category)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .limit(template.maxProducts)
    .returns<Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url">[]>();

  if (productsError) throw new DesignerError(`Error leyendo products: ${productsError.message}`);
  if (!products || products.length === 0) {
    throw new DesignerError(`No hay productos activos en "${category}"`, 400);
  }

  const snapshot: BannerSnapshot = {
    category,
    products: products.map((p) => ({ ...p, price_usd: Number(p.price_usd) })),
    template_version: template.version,
  };

  const html = "<!doctype html>" + renderToStaticMarkup(template.render(snapshot.products, todayLabel()));
  const png = await renderHtmlToPng(html, template.size);

  const storagePath = `${category}/${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const { error: uploadError } = await db.storage
    .from("banners")
    .upload(storagePath, png, { contentType: "image/png", upsert: false });
  if (uploadError) throw new DesignerError(`Error subiendo a Storage: ${uploadError.message}`);

  const imageUrl = db.storage.from("banners").getPublicUrl(storagePath).data.publicUrl;

  const { data: banner, error: insertError } = await db
    .from("banners")
    .insert({
      category,
      image_url: imageUrl,
      storage_path: storagePath,
      width: template.size.width,
      height: template.size.height,
      snapshot_json: snapshot,
    })
    .select()
    .single<Banner>();

  if (insertError) throw new DesignerError(`Error insertando banner: ${insertError.message}`);
  return banner;
}

/** Último banner generado de una categoría, o null. */
export async function latestBanner(category: Category): Promise<Banner | null> {
  const { data, error } = await supabaseAdmin()
    .from("banners")
    .select()
    .eq("category", category)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<Banner>();
  if (error) throw new DesignerError(`Error leyendo banners: ${error.message}`);
  return data;
}
