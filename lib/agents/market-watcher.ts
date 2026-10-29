import type { AgentModule } from "@/lib/agents/runtime";
import { askText } from "@/lib/claude";
import { systemPrompt } from "@/lib/agents/skills";
import type { BusinessContext } from "@/lib/types";

interface DolarRow {
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
  fechaActualizacion: string;
}

async function fetchDolares(): Promise<DolarRow[]> {
  const res = await fetch("https://dolarapi.com/v1/dolares", { cache: "no-store" });
  if (!res.ok) throw new Error(`dolarapi.com respondió ${res.status}`);
  return res.json();
}

interface NewsItem {
  title: string;
  pubDate: string;
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
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    if (title) items.push({ title, pubDate });
  }
  return items;
}

const QUERIES: Record<BusinessContext, string[]> = {
  BNB: ["iPhone Argentina precio", "Apple lanzamiento nuevo", "aranceles importación celulares Argentina"],
  AgroScan: ["SENASA trazabilidad bovina caravana", "precio hacienda Cañuelas INMAG", "retenciones ganadería Argentina"],
  GLOBAL: [],
};

/**
 * Market Watcher (Tomás): dólar del día + noticias relevantes, un resumen por contexto.
 * Dólar de dolarapi.com (sin key), noticias de Google News RSS (sin key). Solo informa, no toca nada.
 */
export const marketWatcher: AgentModule = {
  id: "market-watcher",
  contexts: ["BNB", "AgroScan"],
  requiredEnv: ["ANTHROPIC_API_KEY"],
  async run(ctx) {
    const [dolares, ...newsLists] = await Promise.all([
      fetchDolares().catch((err) => { ctx.log(`dolarapi falló: ${err.message}`); return [] as DolarRow[]; }),
      ...QUERIES[ctx.context].map((q) => fetchNews(q).catch(() => [] as NewsItem[])),
    ]);
    const seen = new Set<string>();
    const news = newsLists.flat().filter((n) => (seen.has(n.title) ? false : (seen.add(n.title), true))).slice(0, 15);

    const dolarText = dolares.length
      ? dolares.map((d) => `${d.nombre}: compra $${d.compra} / venta $${d.venta}`).join("\n")
      : "No pude leer la cotización del dólar hoy (dolarapi.com no respondió).";
    const newsText = news.length ? news.map((n) => `- ${n.title}`).join("\n") : "No encontré titulares relevantes hoy.";

    const prompt =
      `Contexto: ${ctx.context}.\n\n` +
      `Cotizaciones del dólar de hoy (${ctx.today}):\n${dolarText}\n\n` +
      `Titulares de las últimas horas, de varias búsquedas (puede haber ruido, filtralo vos):\n${newsText}\n\n` +
      `Escribí el resumen de mercado del día.`;

    const markdown = await askText({
      agent: "market-watcher",
      role: "analyst",
      system: systemPrompt("market-watcher"),
      prompt,
      usage: ctx.usage,
      maxTokens: 1500,
    });

    const blue = dolares.find((d) => d.casa === "blue");
    return {
      markdown,
      summary: blue ? `dólar blue US$ ${blue.venta} · ${news.length} noticias revisadas` : `${news.length} noticias revisadas`,
      data: { dolares, news },
    };
  },
};
