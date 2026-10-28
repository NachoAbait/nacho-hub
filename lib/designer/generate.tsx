// "react-dom/server" está bloqueado por Next en la capa server; la variante .browser sí se permite
import { renderToStaticMarkup } from "react-dom/server.browser";
import { supabaseAdmin } from "@/lib/supabase";
import { CATEGORIES, type Banner, type BannerSnapshot, type Category, type Product } from "@/lib/types";
import { renderHtmlToPng } from "@/lib/designer/render";
import { BANNER_MAX_PRODUCTS, BANNER_SIZE, BANNER_TEMPLATE_VERSION, CategoryBanner } from "@/components/banners/category";

type SnapshotProduct = BannerSnapshot["products"][number];

/** Todas las categorías comparten la base visual; el template sabe adaptarse a cada una. */
export function hasTemplate(category: Category): boolean {
  return (CATEGORIES as readonly string[]).includes(category);
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

/** Productos activos de una categoría, en el orden del banner. */
export async function activeProducts(category: Category): Promise<SnapshotProduct[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("products")
    .select("id, model, capacity, price_usd, hero_image_url")
    .eq("category", category)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .limit(BANNER_MAX_PRODUCTS)
    .returns<Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url">[]>();
  if (error) throw new DesignerError(`Error leyendo products: ${error.message}`);
  return (data ?? []).map((p) => ({ ...p, price_usd: Number(p.price_usd) }));
}

/**
 * Pipeline completo: productos activos → HTML → PNG → Storage → row en banners.
 * Lo usan el route handler, la server action del dashboard y el agente Designer.
 */
export async function generateBanner(category: Category): Promise<Banner> {
  if (!hasTemplate(category)) throw new DesignerError(`Categoría desconocida "${category}"`, 400);
  const db = supabaseAdmin();

  const products = await activeProducts(category);
  if (products.length === 0) throw new DesignerError(`No hay productos activos en "${category}"`, 400);

  const snapshot: BannerSnapshot = { category, products, template_version: BANNER_TEMPLATE_VERSION };

  const html = "<!doctype html>" + renderToStaticMarkup(<CategoryBanner category={category} products={products} dateLabel={todayLabel()} />);
  const png = await renderHtmlToPng(html, BANNER_SIZE);

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
      width: BANNER_SIZE.width,
      height: BANNER_SIZE.height,
      snapshot_json: snapshot,
    })
    .select()
    .single<Banner>();

  if (insertError) throw new DesignerError(`Error insertando banner: ${insertError.message}`);
  return banner;
}

export interface GenerateAllResult {
  category: Category;
  ok: boolean;
  banner?: Banner;
  error?: string;
  products: number;
}

/** Genera el banner de cada categoría que tenga productos. Una categoría que falla no frena a las demás. */
export async function generateAllBanners(only?: Category[]): Promise<GenerateAllResult[]> {
  const out: GenerateAllResult[] = [];
  for (const category of only ?? CATEGORIES) {
    const products = await activeProducts(category);
    if (products.length === 0) {
      out.push({ category, ok: false, error: "sin productos activos", products: 0 });
      continue;
    }
    try {
      const banner = await generateBanner(category);
      out.push({ category, ok: true, banner, products: products.length });
    } catch (err) {
      out.push({ category, ok: false, error: err instanceof Error ? err.message : String(err), products: products.length });
    }
  }
  return out;
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

/** Último banner de cada categoría. */
export async function latestBanners(): Promise<Partial<Record<Category, Banner>>> {
  const out: Partial<Record<Category, Banner>> = {};
  const { data } = await supabaseAdmin()
    .from("banners")
    .select()
    .order("generated_at", { ascending: false })
    .limit(60)
    .returns<Banner[]>();
  for (const b of data ?? []) if (!out[b.category]) out[b.category] = b;
  return out;
}
