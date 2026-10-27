export const CATEGORIES = [
  "iphone",
  "ipad",
  "macbook",
  "watch",
  "airpods",
  "samsung",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  macbook: "MacBook",
  watch: "Apple Watch",
  airpods: "AirPods",
  samsung: "Samsung",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export type BusinessContext = "BNB" | "AgroScan";

export interface Product {
  id: string;
  category: Category;
  model: string;
  capacity: string | null;
  price_usd: number;
  hero_image_url: string | null;
  display_order: number;
  is_active: boolean;
  context: BusinessContext;
  created_at: string;
  updated_at: string;
}

export interface Banner {
  id: string;
  category: Category;
  generated_at: string;
  image_url: string;
  storage_path: string;
  width: number;
  height: number;
  snapshot_json: BannerSnapshot;
}

/** Lo que se guarda en banners.snapshot_json: exactamente lo que se renderizó. */
export interface BannerSnapshot {
  category: Category;
  products: Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url">[];
  template_version: number;
}
