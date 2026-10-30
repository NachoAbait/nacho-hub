import { fetchExpenses, fetchSales, fetchStock, nexiosAvailable, normalizeCapacity, normalizeModel } from "@/lib/nexios";

export function todayArt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function daysAgoArt(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
}

export interface StockReportRow {
  model: string;
  capacity: string | null;
  deviceType: string;
  units: number;
  costUsd: number;
  priceUsd: number | null;
  agingDays: number;
  soldUnits: number;
  revenueUsd: number;
  sellThrough: number | null;
  daysOfInventory: number | null;
}

export interface StockReport {
  available: boolean;
  from: string;
  to: string;
  netCash: number;
  capitalTiedUp: number;
  unitsInStock: number;
  salesCount: number;
  rows: StockReportRow[];
}

/**
 * Lo mismo que calcula Julieta (Stock Analyst) para su informe, separado para que también lo pueda
 * usar el panel visual (siempre en vivo, no espera a la próxima corrida programada).
 */
export async function computeStockReport(): Promise<StockReport> {
  if (!nexiosAvailable()) {
    return { available: false, from: "", to: "", netCash: 0, capitalTiedUp: 0, unitsInStock: 0, salesCount: 0, rows: [] };
  }

  const to = todayArt();
  const from = daysAgoArt(30);
  const [sales, stock, expenses] = await Promise.all([fetchSales(from, to), fetchStock(), fetchExpenses(from, to)]);
  if (!stock) {
    return { available: false, from, to, netCash: 0, capitalTiedUp: 0, unitsInStock: 0, salesCount: 0, rows: [] };
  }

  const soldByKey = new Map<string, { units: number; revenue: number }>();
  for (const s of sales?.by_model ?? []) {
    const m = s.model.match(/^(.*?)(?:\s+(\d+\s?(?:gb|tb)))?$/i);
    const key = `${normalizeModel(m?.[1] ?? s.model)}|${normalizeCapacity(m?.[2] ?? null)}`;
    const cur = soldByKey.get(key) ?? { units: 0, revenue: 0 };
    cur.units += s.units;
    cur.revenue += s.revenue_usd;
    soldByKey.set(key, cur);
  }

  const rows: StockReportRow[] = stock.map((p) => {
    const key = `${normalizeModel(p.model)}|${normalizeCapacity(p.capacity)}`;
    const sold = soldByKey.get(key) ?? { units: 0, revenue: 0 };
    const agingDays = Math.round((Date.now() - new Date(p.oldest_entry + "T00:00:00-03:00").getTime()) / 86400_000);
    const sellThrough = p.units + sold.units > 0 ? sold.units / (p.units + sold.units) : null;
    const dailyRate = sold.units / 30;
    const daysOfInventory = dailyRate > 0 ? p.units / dailyRate : null;
    return {
      model: p.model, capacity: p.capacity, deviceType: p.device_type, units: p.units, costUsd: p.cost_usd,
      priceUsd: p.price_usd, agingDays, soldUnits: sold.units, revenueUsd: sold.revenue, sellThrough, daysOfInventory,
    };
  });

  const capitalTiedUp = rows.reduce((n, r) => n + r.costUsd, 0);
  const netCash = (sales?.revenue_usd ?? 0) - (expenses?.total_usd ?? 0);

  return {
    available: true,
    from,
    to,
    netCash,
    capitalTiedUp,
    unitsInStock: rows.reduce((n, r) => n + r.units, 0),
    salesCount: sales?.sales_count ?? 0,
    rows: rows.filter((r) => r.units > 0 || r.soldUnits > 0),
  };
}
