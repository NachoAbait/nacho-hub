import type { BusinessContext } from "@/lib/types";

export interface DolarRow {
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
  fechaActualizacion: string;
}

export interface NewsItem {
  title: string;
  link: string | null;
  pubDate: string;
}

export interface MarketReport {
  dolares: DolarRow[];
  news: NewsItem[];
}

async function fetchDolares(): Promise<DolarRow[]> {
  const res = await fetch("https://dolarapi.com/v1/dolares", { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

/** Google News RSS: sin API key, sin login. Un regex alcanza, no hace falta un parser de XML. */
async function fetchNews(query: string, limit = 8): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=AR&ceid=AR:es-419`;
  const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? null;
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    if (title) items.push({ title, link, pubDate });
  }
  return items;
}

const QUERIES: Record<BusinessContext, string[]> = {
  BNB: ["iPhone Argentina precio", "Apple lanzamiento nuevo", "aranceles importación celulares Argentina"],
  AgroScan: ["SENASA trazabilidad bovina caravana", "precio hacienda Cañuelas INMAG", "retenciones ganadería Argentina"],
  GLOBAL: [
    "Reserva Federal Wall Street economía Estados Unidos",
    "Bitcoin criptomonedas noticias hackeo",
    "geopolítica economía guerra aranceles comercio",
    "economía mundial mercados financieros",
  ],
};

/** Lo mismo que lee Tomás (Market Watcher): dólar del día + noticias. También lo usa Mateo (Global Analyst) para GLOBAL, solo las noticias. Compartido con el panel visual, siempre en vivo. */
export async function computeMarketReport(context: BusinessContext): Promise<MarketReport> {
  const [dolares, ...newsLists] = await Promise.all([
    fetchDolares(),
    ...QUERIES[context].map((q) => fetchNews(q).catch(() => [] as NewsItem[])),
  ]);
  const seen = new Set<string>();
  const news = newsLists.flat().filter((n) => (seen.has(n.title) ? false : (seen.add(n.title), true))).slice(0, 15);
  return { dolares, news };
}
