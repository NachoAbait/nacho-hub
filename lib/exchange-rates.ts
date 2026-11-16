/**
 * Cotización del dólar — MISMA lógica que resellerapp/src/lib/exchange-rates.ts, portada acá
 * porque el Designer (banners) necesita el mismo número que ve el cliente en el catálogo público
 * de NexiOS, y NexiOS no expone esto por ninguna API: hay que llamar a las mismas fuentes.
 *
 * OJO: si cambia la lógica de fuentes/providers en resellerapp, hay que actualizar esto a mano —
 * no hay forma de compartir código entre los dos repos hoy.
 *
 * Fuente real usada por NexiOS: criptoya.com como agregador, con DolarHoy/Ámbito/Bluelytics como
 * fuentes individuales para blue/tarjeta/mayorista (el organization elige UN provider puntual,
 * ej. "dolarhoy" — no "lo que esté disponible").
 */

export type ExchangeRateSource = "manual" | "blue" | "cripto" | "mep" | "ccl" | "oficial" | "tarjeta" | "mayorista";

const EXCHANGE_RATE_SOURCES: readonly ExchangeRateSource[] = ["manual", "blue", "cripto", "mep", "ccl", "oficial", "tarjeta", "mayorista"];

export function isExchangeRateSource(value: string): value is ExchangeRateSource {
  return (EXCHANGE_RATE_SOURCES as readonly string[]).includes(value);
}

export interface ProviderRate {
  compra: number | null;
  venta: number;
  timestamp?: number;
}

export type RatesByProvider = Record<string, ProviderRate>;

const FETCH_OPTS: RequestInit = { cache: "no-store", headers: { Accept: "application/json" } };

async function fetchAll(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("https://criptoya.com/api/dolar", FETCH_OPTS);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function parseARSNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9,.]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const SCRAPER_OPTS: RequestInit = {
  cache: "no-store",
  headers: { Accept: "application/json, text/html", "User-Agent": "Mozilla/5.0 (compatible; NexiOS/1.0)" },
};

async function fetchAmbitoSingle(slug: string): Promise<ProviderRate | null> {
  try {
    const res = await fetch(`https://mercados.ambito.com//dolar/${slug}/variacion`, SCRAPER_OPTS);
    if (!res.ok) return null;
    const data = (await res.json()) as { compra?: string; venta?: string };
    const compra = parseARSNumber(data.compra);
    const venta = parseARSNumber(data.venta);
    if (!venta) return null;
    return { compra, venta, timestamp: Date.now() / 1000 };
  } catch {
    return null;
  }
}

async function fetchDolarHoy(path: string): Promise<ProviderRate | null> {
  try {
    const res = await fetch(`https://dolarhoy.com/${path}`, SCRAPER_OPTS);
    if (!res.ok) return null;
    const html = await res.text();
    const matches = [...html.matchAll(/class="value">\$?([0-9.,]+)/g)].map((m) => parseARSNumber(m[1])).filter((n): n is number => n != null);
    if (matches.length === 0) return null;
    if (matches.length >= 2) return { compra: matches[0], venta: matches[1], timestamp: Date.now() / 1000 };
    return { compra: null, venta: matches[0], timestamp: Date.now() / 1000 };
  } catch {
    return null;
  }
}

async function fetchBluelytics(): Promise<{ blue: ProviderRate | null; oficial: ProviderRate | null }> {
  try {
    const res = await fetch("https://api.bluelytics.com.ar/v2/latest", SCRAPER_OPTS);
    if (!res.ok) return { blue: null, oficial: null };
    const data = (await res.json()) as Record<string, { value_sell?: number; value_buy?: number }>;
    const ts = Date.now() / 1000;
    const blue = data.blue && typeof data.blue.value_sell === "number" ? { compra: data.blue.value_buy ?? null, venta: data.blue.value_sell, timestamp: ts } : null;
    const oficial = data.oficial && typeof data.oficial.value_sell === "number" ? { compra: data.oficial.value_buy ?? null, venta: data.oficial.value_sell, timestamp: ts } : null;
    return { blue, oficial };
  } catch {
    return { blue: null, oficial: null };
  }
}

const DOLARHOY_PATHS: Partial<Record<"blue" | "tarjeta" | "mayorista", string>> = {
  blue: "cotizaciondolarblue",
  tarjeta: "cotizacion-dolar-tarjeta",
  mayorista: "cotizacion-dolar-mayorista",
};

const AMBITO_SLUGS: Partial<Record<"blue" | "tarjeta" | "mayorista", string>> = {
  blue: "informal",
  tarjeta: "tarjeta",
  mayorista: "mayorista",
};

async function fetchExtraSources(type: "blue" | "tarjeta" | "mayorista"): Promise<RatesByProvider> {
  const result: RatesByProvider = {};
  const dhPath = DOLARHOY_PATHS[type];
  const amSlug = AMBITO_SLUGS[type];
  const wantBlueLytics = type === "blue";
  const [dh, am, bl] = await Promise.all([
    dhPath ? fetchDolarHoy(dhPath) : Promise.resolve(null),
    amSlug ? fetchAmbitoSingle(amSlug) : Promise.resolve(null),
    wantBlueLytics ? fetchBluelytics().then((r) => r.blue) : Promise.resolve(null),
  ]);
  if (dh) result.dolarhoy = dh;
  if (am) result.ambito = am;
  if (bl) result.bluelytics = bl;
  return result;
}

async function fetchPerSource(type: "oficial" | "cripto"): Promise<RatesByProvider> {
  try {
    const res = await fetch(`https://criptoya.com/api/dolar/${type}`, FETCH_OPTS);
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, Record<string, unknown>>;
    const result: RatesByProvider = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== "object" || !v) continue;
      const ask = typeof v.ask === "number" ? v.ask : typeof v.totalAsk === "number" ? v.totalAsk : null;
      const bid = typeof v.bid === "number" ? v.bid : typeof v.totalBid === "number" ? v.totalBid : null;
      if (ask && ask > 0) result[k] = { compra: bid, venta: ask, timestamp: typeof v.time === "number" ? v.time : undefined };
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchRates(type: Exclude<ExchangeRateSource, "manual">): Promise<RatesByProvider> {
  if (type === "oficial" || type === "cripto") return fetchPerSource(type);

  const all = await fetchAll();
  if (!all) return {};
  const obj = all[type] as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== "object") return {};

  if (type === "mep" || type === "ccl") {
    const result: RatesByProvider = {};
    for (const [bond, sub] of Object.entries(obj)) {
      if (typeof sub !== "object" || !sub) continue;
      for (const [tf, val] of Object.entries(sub as Record<string, unknown>)) {
        if (typeof val !== "object" || !val || typeof (val as { price?: unknown }).price !== "number") continue;
        const v = val as { price: number; timestamp?: number };
        result[`${bond}-${tf}`] = { compra: null, venta: v.price, timestamp: typeof v.timestamp === "number" ? v.timestamp : undefined };
      }
    }
    return result;
  }

  const venta = typeof obj.ask === "number" ? obj.ask : typeof obj.price === "number" ? obj.price : null;
  const compra = typeof obj.bid === "number" ? obj.bid : null;
  const result: RatesByProvider = {};
  if (venta && venta > 0) result.criptoya = { compra, venta, timestamp: typeof obj.timestamp === "number" ? obj.timestamp : undefined };
  Object.assign(result, await fetchExtraSources(type as "blue" | "tarjeta" | "mayorista"));
  return result;
}

export async function computeEffectiveRate(opts: {
  type: ExchangeRateSource;
  provider: string | null;
  markupPct: number;
  manual: number | null;
}): Promise<{ rate: number | null; base: number | null; source: "live" | "manual" | "none"; provider?: string }> {
  const markup = (opts.markupPct ?? 0) / 100;

  if (opts.type === "manual") {
    if (opts.manual && opts.manual > 0) return { rate: opts.manual * (1 + markup), base: opts.manual, source: "manual" };
    return { rate: null, base: null, source: "none" };
  }

  const rates = await fetchRates(opts.type);
  const provider = opts.provider && rates[opts.provider] ? opts.provider : Object.keys(rates)[0];
  const r = provider ? rates[provider] : null;

  if (r && r.venta > 0) return { rate: r.venta * (1 + markup), base: r.venta, source: "live", provider };
  if (opts.manual && opts.manual > 0) return { rate: opts.manual * (1 + markup), base: opts.manual, source: "manual" };
  return { rate: null, base: null, source: "none" };
}
