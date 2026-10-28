/** Prueba local del Price Reader: npx tsx --env-file=.env.local scripts/test-ingest.tsx "mensaje" */
import { ingestPriceList } from "../lib/agents/ingest";
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const body = process.argv[2] ?? "iPhone 17 Pro Max 256 1250 / 512 1480 x3 1230";
  const r = await ingestPriceList({ source: "manual", body });
  console.log(JSON.stringify(r, null, 1));
  const { data } = await supabaseAdmin().from("price_updates").select("model, capacity, detected_cost_usd, original_price_usd, pricing_basis, bulk_qty, status, raw_line").order("created_at", { ascending: false }).limit(5);
  console.log(data);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
