/**
 * Preview local de un template sin Supabase:
 *   npx tsx scripts/preview-banner.tsx iphone [salida.png]
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { IphoneBanner, IPHONE_BANNER_SIZE } from "../components/banners/iphone";
import { renderHtmlToPng } from "../lib/designer/render";

const SAMPLE = [
  { id: "1", model: "iPhone 17 Pro Max", capacity: "256 GB", price_usd: 1499, hero_image_url: null },
  { id: "2", model: "iPhone 17 Pro", capacity: "256 GB", price_usd: 1299, hero_image_url: null },
  { id: "3", model: "iPhone 17", capacity: "256 GB", price_usd: 1049, hero_image_url: null },
  { id: "4", model: "iPhone Air", capacity: "256 GB", price_usd: 1199, hero_image_url: null },
  { id: "5", model: "iPhone 16", capacity: "128 GB", price_usd: 849, hero_image_url: null },
  { id: "6", model: "iPhone 16e", capacity: "128 GB", price_usd: 699, hero_image_url: null },
  { id: "7", model: "iPhone 17 Pro Max", capacity: "512 GB", price_usd: 1779, hero_image_url: null },
  { id: "8", model: "iPhone 17 Pro Max", capacity: "1 TB", price_usd: 2059, hero_image_url: null },
];

async function main() {
  const category = process.argv[2] ?? "iphone";
  const out = process.argv[3] ?? `preview-${category}.png`;
  if (category !== "iphone") throw new Error(`Sin template para ${category}`);

  const html = "<!doctype html>" + renderToStaticMarkup(<IphoneBanner products={SAMPLE} dateLabel="27 de octubre" />);
  const t0 = Date.now();
  const png = await renderHtmlToPng(html, IPHONE_BANNER_SIZE);
  writeFileSync(out, png);
  console.log(`✓ ${out} (${(png.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
