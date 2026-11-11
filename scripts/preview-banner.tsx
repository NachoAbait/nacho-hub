/**
 * Preview local de un template sin Supabase:
 *   npx tsx scripts/preview-banner.tsx [categoria] [salida.png]
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BANNER_SIZE, CategoryBanner, type BannerProduct } from "../components/banners/category";
import { renderHtmlToPng } from "../lib/designer/render";
import { isCategory, type Category } from "../lib/types";

const SAMPLE: Record<Category, BannerProduct[]> = {
  iphone: [
    { id: "1", model: "iPhone 17 Pro Max", capacity: "256GB", price_usd: 1499, hero_image_url: null, attributes: null },
    { id: "2", model: "iPhone 17 Pro", capacity: "256GB", price_usd: 1299, hero_image_url: null, attributes: null },
    { id: "3", model: "iPhone 17", capacity: "256GB", price_usd: 1049, hero_image_url: null, attributes: null },
    { id: "4", model: "iPhone 16", capacity: "128GB", price_usd: 849, hero_image_url: null, attributes: null },
    { id: "5", model: "iPhone 16e", capacity: "128GB", price_usd: 699, hero_image_url: null, attributes: null },
    { id: "6", model: "iPhone 17 Pro Max", capacity: "512GB", price_usd: 1779, hero_image_url: null, attributes: null },
  ],
  ipad: [
    { id: "1", model: "iPad", capacity: "128GB", price_usd: 590, hero_image_url: null, attributes: { chip: "A16", screen: "11\"" } },
    { id: "2", model: "iPad", capacity: "256GB", price_usd: 700, hero_image_url: null, attributes: { chip: "A16", screen: "11\"" } },
    { id: "3", model: "iPad Air", capacity: "128GB", price_usd: 850, hero_image_url: null, attributes: { chip: "M4", screen: "11\"" } },
    { id: "4", model: "iPad Air", capacity: "256GB", price_usd: 990, hero_image_url: null, attributes: { chip: "M4", screen: "11\"" } },
  ],
  macbook: [
    { id: "1", model: "MacBook Air", capacity: "512GB", price_usd: 1460, hero_image_url: null, attributes: { chip: "M5", screen: "13\"", ram: "16GB" } },
    { id: "2", model: "MacBook Air", capacity: "512GB", price_usd: 1680, hero_image_url: null, attributes: { chip: "M5", screen: "15\"", ram: "16GB" } },
    { id: "3", model: "MacBook NEO", capacity: "256GB", price_usd: 920, hero_image_url: null, attributes: { chip: "A18", screen: "13\"", ram: "8GB" } },
    { id: "4", model: "MacBook NEO", capacity: "512GB", price_usd: 1020, hero_image_url: null, attributes: { chip: "A18", screen: "13\"", ram: "8GB" } },
    { id: "5", model: "MacBook Pro", capacity: "1TB", price_usd: 2850, hero_image_url: null, attributes: { chip: "M5 Pro", screen: "14\"", ram: "24GB" } },
  ],
  watch: [
    { id: "1", model: "Apple Watch SE 3", capacity: null, price_usd: 360, hero_image_url: null, attributes: { screen: "40mm" } },
    { id: "2", model: "Apple Watch SE 3", capacity: null, price_usd: 380, hero_image_url: null, attributes: { screen: "44mm" } },
    { id: "3", model: "Apple Watch Series 11", capacity: null, price_usd: 480, hero_image_url: null, attributes: { screen: "46mm" } },
    { id: "4", model: "Apple Watch Series 12", capacity: null, price_usd: 520, hero_image_url: null, attributes: { screen: "42mm" } },
    { id: "5", model: "Apple Watch Series 12", capacity: null, price_usd: 600, hero_image_url: null, attributes: { screen: "46mm" } },
    { id: "6", model: "Apple Watch Ultra 4", capacity: null, price_usd: 990, hero_image_url: null, attributes: { screen: "49mm", connectivity: "GPS + Cellular" } },
  ],
  airpods: [
    { id: "1", model: "AirPods 4", capacity: null, price_usd: 260, hero_image_url: null, attributes: null },
    { id: "2", model: "AirPods Pro 3", capacity: null, price_usd: 320, hero_image_url: null, attributes: null },
    { id: "3", model: "AirPods 5", capacity: null, price_usd: 300, hero_image_url: null, attributes: null },
  ],
  samsung: [
    { id: "1", model: "Galaxy S25 Ultra", capacity: "256GB", price_usd: 930, hero_image_url: null, attributes: null },
    { id: "2", model: "Galaxy S25 Ultra", capacity: "512GB", price_usd: 1010, hero_image_url: null, attributes: null },
    { id: "3", model: "Galaxy S26 Ultra", capacity: "256GB", price_usd: 1120, hero_image_url: null, attributes: null },
    { id: "4", model: "Galaxy A57", capacity: "256GB", price_usd: 620, hero_image_url: null, attributes: null },
  ],
};

async function main() {
  const arg = process.argv[2] ?? "iphone";
  if (!isCategory(arg)) throw new Error(`Categoría desconocida "${arg}"`);
  const category = arg;
  const out = process.argv[3] ?? `preview-${category}.png`;

  const html = "<!doctype html>" + renderToStaticMarkup(<CategoryBanner category={category} products={SAMPLE[category]} usdArs={1622} />);
  const t0 = Date.now();
  const png = await renderHtmlToPng(html, BANNER_SIZE);
  writeFileSync(out, png);
  console.log(`✓ ${out} (${(png.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
