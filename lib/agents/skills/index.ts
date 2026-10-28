/**
 * Playbooks de los agentes: el "entrenamiento profesional" de cada uno, como system prompt.
 * Van como módulos TS (no .md) para que entren en el bundle de Vercel sin configuración extra.
 */
import { PRICE_READER } from "./price-reader";
import { MARKET_WATCHER } from "./market-watcher";
import { COMPETITOR_SCRAPER } from "./competitor-scraper";
import { SOCIAL_COLLECTOR } from "./social-collector";
import { PRICE_ANALYST } from "./price-analyst";
import { CONTENT_ANALYST } from "./content-analyst";
import { ADS_ANALYST } from "./ads-analyst";
import { STOCK_ANALYST } from "./stock-analyst";
import { CONTENT_CREATOR } from "./content-creator";
import { COPY_WRITER } from "./copy-writer";
import { DM_HANDLER } from "./dm-handler";
import { CHIEF_OF_STAFF } from "./chief-of-staff";

/** Reglas comunes a todos los informes: tono, idioma, formato. */
export const HOUSE_STYLE = `
## Estilo de los informes

- Español rioplatense, voseo, directo. El lector es Nacho, dueño del negocio, que lee esto a las 07:30 con un café.
- Markdown simple: un título H1, subtítulos H2, listas cortas. Nada de tablas enormes.
- Primero lo que importa y lo que hay que hacer. Después el detalle.
- Números concretos con unidad (US$ 1.250, 3,2 %, 14 ventas). Sin relleno ni frases de cortesía.
- Si no tenés un dato, decilo en una línea y seguí. No inventes.
- Cerrá siempre con una sección "## Para hoy" de 1 a 3 acciones concretas, cada una en una línea.
`;

/** Contexto fijo de los dos negocios, para que todos hablen del mismo mundo. */
export const BUSINESS_CONTEXT = `
## Los negocios

- **BNB Store** (Dolores, Buenos Aires, Argentina): reventa de Apple y Samsung nuevos sellados (iPhone, iPad, MacBook,
  Apple Watch, AirPods, Galaxy) y usados. Vende por Instagram (@bnbstore.dolores, ~16.600 seguidores), WhatsApp y
  catálogo público en nexiosapp.com. Precios en dólares, cobra en dólares o pesos al blue. Margen típico US$ 80 a 150 por equipo.
  Competencia: otros resellers de Dolores y la zona (Chascomús, Castelli, Lezama, General Guido), tiendas de CABA que envían
  al interior, y MercadoLibre.
- **AgroScan**: app de gestión y trazabilidad ganadera (pesadas con bastón de caravanas electrónicas, sanidad, servicios,
  carga por WhatsApp). Está en etapa de prototipo con productores de la zona de Dolores; todavía no cobra. Instagram @agroscan.
  Su mundo: SENASA, caravanas, Mercado Agroganadero de Cañuelas (índice INMAG), precio del novillo, productores de cría e invernada.
`;

const SKILLS: Record<string, string> = {
  "price-reader": PRICE_READER,
  "market-watcher": MARKET_WATCHER,
  "competitor-scraper": COMPETITOR_SCRAPER,
  "social-collector": SOCIAL_COLLECTOR,
  "price-analyst": PRICE_ANALYST,
  "content-analyst": CONTENT_ANALYST,
  "ads-analyst": ADS_ANALYST,
  "stock-analyst": STOCK_ANALYST,
  "content-creator": CONTENT_CREATOR,
  "copy-writer": COPY_WRITER,
  "dm-handler": DM_HANDLER,
  "chief-of-staff": CHIEF_OF_STAFF,
};

/** System prompt completo de un agente: playbook + contexto de negocio + estilo. */
export function systemPrompt(agentId: string): string {
  const skill = SKILLS[agentId];
  if (!skill) throw new Error(`No hay playbook para ${agentId}`);
  return `${skill.trim()}\n\n${BUSINESS_CONTEXT.trim()}\n\n${HOUSE_STYLE.trim()}`;
}
