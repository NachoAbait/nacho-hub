/* eslint-disable @next/next/no-head-element, @next/next/google-font-display, @next/next/no-page-custom-font */
// Documento HTML completo y aislado: lo renderiza Playwright, no Next. Por eso no usa next/head ni next/font.
import type { Product, ProductAttributes } from "@/lib/types";
import type { Category } from "@/lib/types";

/** Subir cuando cambie el diseño; queda guardado en snapshot_json. */
export const BANNER_TEMPLATE_VERSION = 4;

export const BANNER_SIZE = { width: 1080, height: 1920 } as const;

/** Cuántos SKU como máximo trae la consulta a `products` antes de agrupar y acotar filas. */
export const BANNER_FETCH_LIMIT = 60;

/** Filas de variante (tamaño/capacidad) que entran como máximo en la historia, sumando todas las
 * cards — no "productos": una Apple Watch con 3 tamaños ya son 3 filas. Ajustado para que, con el
 * alto de fila actual, nunca se pase del cuadro de 1920px (el body corta lo que sobra). */
const MAX_VARIANT_ROWS = 12;

export type BannerProduct = Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url" | "attributes">;

export interface CategoryBannerProps {
  category: Category;
  products: BannerProduct[];
  /** Cotización pesos de la propia NexiOS (Ajustes → casa + recargo). Null si no se pudo leer: no se inventa un precio en pesos. */
  usdArs: number | null;
}

/** Título y acento por categoría. Mismo lenguaje visual (negro + dorado) para toda la marca; Samsung en celeste.
 * showHero en false (iPhone): hay tantos modelos a la vez que una sola foto arriba no identifica a
 * ninguno en particular — mejor usar ese espacio para que cada card (con su propio render) quede
 * más grande, ya que son muchas filas compitiendo por lugar. */
export const CATEGORY_STYLE: Record<Category, { title: string; upper?: boolean; showHero?: boolean; accent: string; light: string; dark: string }> = {
  iphone: { title: "iPhones", showHero: false, accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  ipad: { title: "iPad", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  macbook: { title: "MacBook", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  watch: { title: "Apple Watch", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  airpods: { title: "AirPods", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  samsung: { title: "Samsung", upper: true, accent: "#8fb7ff", light: "#d6e4ff", dark: "#3b63b8" },
};

const BENEFITS = ["Entrega inmediata", "Garantía BNB", "Productos originales", "Cuotas disponibles"];

export function formatUsd(value: number): string {
  return "US$ " + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatArs(value: number): string {
  return "$ " + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "11\"", "13¨", "13 pulg" → "11"": el catálogo legado no siempre usó la misma comilla. */
function normalizeInches(raw: string): string {
  const num = raw.replace(/[^\d.]/g, "");
  return num ? `${num}"` : raw;
}

interface Chip {
  label: string;
  kind: "size" | "capacity" | "ram";
}

/** Qué chips le corresponden a un SKU según la categoría: nunca inventa un dato que no esté en attributes/capacity. */
function buildChips(category: Category, capacity: string | null, attrs: ProductAttributes | null): Chip[] {
  const chips: Chip[] = [];
  if (category === "watch") {
    if (attrs?.screen) chips.push({ label: attrs.screen, kind: "size" });
  } else if (category === "ipad" || category === "macbook") {
    if (attrs?.screen) chips.push({ label: normalizeInches(attrs.screen), kind: "size" });
    if (capacity) chips.push({ label: capacity, kind: "capacity" });
    if (attrs?.ram) chips.push({ label: /gb|tb/i.test(attrs.ram) ? `${attrs.ram} RAM` : `${attrs.ram}GB RAM`, kind: "ram" });
  } else if (capacity) {
    chips.push({ label: capacity, kind: "capacity" });
  }
  return chips;
}

/** Encabezado de card: marca (peso regular) + línea/chip (peso bold, con el acento). */
function splitTitle(category: Category, model: string, chip: string | null | undefined): { brand: string; line: string } {
  if (category === "watch") {
    const line = model.replace(/^apple\s*watch\s*/i, "").trim();
    return { brand: "Apple Watch", line: line || model };
  }
  if (category === "samsung") {
    const line = model.replace(/^galaxy\s*/i, "").trim();
    return { brand: "Galaxy", line: line || model };
  }
  if ((category === "ipad" || category === "macbook") && chip) {
    return { brand: model, line: chip };
  }
  return { brand: "", line: model };
}

interface Variant {
  id: string;
  chips: Chip[];
  priceUsd: number;
}

interface Group {
  key: string;
  brand: string;
  line: string;
  heroImageUrl: string | null;
  variants: Variant[];
}

/** Agrupa por modelo (iPad/MacBook además por chip, porque "iPad Air" existe con M3 y M4 a la vez):
 * una Apple Watch con 40mm y 44mm es UNA card con dos filas, no dos cards sueltas. */
function groupProducts(category: Category, products: BannerProduct[]): Group[] {
  const map = new Map<string, Group>();
  const order: string[] = [];
  for (const p of products) {
    const chip = p.attributes?.chip ?? null;
    const key = category === "ipad" || category === "macbook" ? `${p.model}__${chip ?? ""}` : p.model;
    let g = map.get(key);
    if (!g) {
      const { brand, line } = splitTitle(category, p.model, chip);
      g = { key, brand, line, heroImageUrl: p.hero_image_url, variants: [] };
      map.set(key, g);
      order.push(key);
    }
    if (!g.heroImageUrl && p.hero_image_url) g.heroImageUrl = p.hero_image_url;
    g.variants.push({ id: p.id, chips: buildChips(category, p.capacity, p.attributes), priceUsd: p.price_usd });
  }
  const groups = order.map((k) => map.get(k)!);
  for (const g of groups) g.variants.sort((a, b) => a.priceUsd - b.priceUsd);
  // Barato primero, como en el catálogo real: SE antes que Series, Series antes que Ultra.
  groups.sort((a, b) => a.variants[0].priceUsd - b.variants[0].priceUsd);
  return groups;
}

/** Corta por FILA total (no por card): una card larga nunca empuja a las demás fuera del cuadro. */
function capRows(groups: Group[], maxRows: number): Group[] {
  const out: Group[] = [];
  let used = 0;
  for (const g of groups) {
    if (used >= maxRows) break;
    const take = Math.min(g.variants.length, maxRows - used);
    out.push({ ...g, variants: g.variants.slice(0, take) });
    used += take;
  }
  return out;
}

const ICONS = {
  truck: (
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="7" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </>
  ),
  card: (
    <>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </>
  ),
};
const BENEFIT_ICONS = [ICONS.truck, ICONS.shield, ICONS.award, ICONS.card];

/** `big`: cuando la categoría no muestra la foto grande de arriba (showHero false, hoy solo
 * iPhone), las cards usan ese espacio liberado para quedar más grandes en vez de dejarlo vacío. */
function css(accent: string, light: string, dark: string, big: boolean) {
  const cardPad = big ? "15px 22px" : "11px 20px";
  const thumbW = big ? 92 : 70;
  const thumbImgH = big ? 128 : 100;
  const thumbPhW = big ? 56 : 44;
  const thumbPhH = big ? 108 : 86;
  const titleSize = big ? 33 : 27;
  const rowPad = big ? "9px 0" : "6px 0";
  const chipSize = big ? 19 : 17;
  const chipPad = big ? "3px 12px" : "2px 10px";
  const simpleSize = big ? 33 : 27;
  const usdSize = big ? 39 : 32;
  const arsSize = big ? 21 : 18;
  const listGap = big ? 16 : 10;
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${BANNER_SIZE.width}px; height: ${BANNER_SIZE.height}px; overflow: hidden; }
  body { background: #000; color: #fff; font-family: "Inter", system-ui, -apple-system, sans-serif; position: relative; }
  .backdrop { position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 60% 30% at 18% 8%, ${accent}4a, transparent 60%),
      radial-gradient(ellipse 50% 26% at 85% 4%, ${accent}3d, transparent 60%),
      radial-gradient(ellipse 70% 40% at 50% 100%, ${accent}26, transparent 70%),
      linear-gradient(180deg, #060402 0%, #0b0805 45%, #15100a 100%);
  }
  .backdrop::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.03) 48%, transparent 56%); }
  .grain { position: absolute; inset: 0; opacity: 0.07; mix-blend-mode: screen;
    background-image: radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 0.5px); background-size: 4px 4px; }
  .page { position: relative; height: 100%; padding: 84px 60px 52px; display: flex; flex-direction: column; }
  .eyebrow-row { display: flex; align-items: center; gap: 18px; }
  .eyebrow { font-size: 24px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: rgba(255,255,255,0.85); white-space: nowrap; }
  .eyebrow-line { flex: 1; height: 1px; background: linear-gradient(90deg, ${accent}, transparent); }
  .title { margin-top: 14px; font-weight: 900; font-size: 132px; line-height: 0.92; letter-spacing: -0.03em;
    background: linear-gradient(180deg, ${light} 0%, ${accent} 55%, ${dark} 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; white-space: nowrap; }
  .title.upper { text-transform: uppercase; }
  .title-sub { font-size: 44px; font-weight: 500; color: rgba(255,255,255,0.75); letter-spacing: -0.01em; }
  .subtitle { margin-top: 8px; font-size: 25px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.55); }
  .hero { margin: 24px 0 4px; display: flex; justify-content: center; align-items: center; height: 260px; position: relative; }
  .hero-glow { position: absolute; width: 440px; height: 240px; border-radius: 50%;
    background: radial-gradient(ellipse, ${accent}40, transparent 70%); filter: blur(2px); }
  .hero img { position: relative; max-width: 380px; max-height: 260px; object-fit: contain; filter: drop-shadow(0 24px 36px rgba(0,0,0,0.65)); }
  .list { margin-top: 14px; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: ${listGap}px; min-height: 0; }
  .card { border-radius: 22px; border: 1px solid ${accent}4d;
    background: linear-gradient(160deg, rgba(255,255,255,0.05), rgba(0,0,0,0.25));
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); overflow: hidden; }
  .card-inner { display: flex; align-items: stretch; padding: ${cardPad}; gap: 18px; }
  .thumb { flex: none; width: ${thumbW}px; display: flex; align-items: center; justify-content: center; }
  .thumb img { max-width: 100%; max-height: ${thumbImgH}px; object-fit: contain; filter: drop-shadow(0 8px 14px rgba(0,0,0,0.6)); }
  .thumb-placeholder { width: ${thumbPhW}px; height: ${thumbPhH}px; border-radius: 12px; border: 2px solid rgba(255,255,255,0.15);
    background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02)); }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .group-title { font-size: ${titleSize}px; line-height: 1.15; padding-bottom: 5px; }
  .brand { font-weight: 500; color: rgba(255,255,255,0.8); }
  .line { font-weight: 800; background: linear-gradient(180deg, ${light}, ${accent});
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .rows { display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: ${rowPad}; }
  .row + .row { border-top: 1px solid rgba(255,255,255,0.08); }
  .chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chip { font-size: ${chipSize}px; font-weight: 700; padding: ${chipPad}; border-radius: 8px; border: 1.5px solid; white-space: nowrap; }
  .chip-size { color: #f3b96a; border-color: #f3b96a80; }
  .chip-capacity { color: #7fb6ff; border-color: #7fb6ff80; }
  .chip-ram { color: #c6a4ff; border-color: #c6a4ff80; }
  .simple-name { font-size: ${simpleSize}px; font-weight: 700; color: #fff; }
  .prices { text-align: right; flex: none; }
  .usd { font-weight: 900; font-size: ${usdSize}px; line-height: 1; letter-spacing: -0.01em;
    background: linear-gradient(180deg, ${light}, ${accent}); -webkit-background-clip: text; background-clip: text; color: transparent; white-space: nowrap; }
  .ars { margin-top: 2px; font-size: ${arsSize}px; font-weight: 600; color: rgba(255,255,255,0.45); white-space: nowrap; }
  .footer { margin-top: 18px; padding-top: 18px; border-top: 1px solid ${accent}40; }
  .benefits { display: flex; justify-content: space-between; }
  .benefit { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 23%; text-align: center; }
  .benefit svg { width: 30px; height: 30px; stroke: ${accent}; fill: none; stroke-width: 1.6; }
  .benefit span { font-size: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.75); line-height: 1.25; }
  .brandfoot { margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 18px; }
  .brandfoot .bar { width: 48px; height: 1px; background: ${accent}80; }
  .brandfoot .logo { font-size: 30px; font-weight: 900; letter-spacing: 0.02em; color: #fff; }
`;
}

/** Banner de precios de una categoría. Base visual compartida (negro + bokeh dorado, chips de variante, precio en USD y pesos). */
export function CategoryBanner({ category, products, usdArs }: CategoryBannerProps) {
  const style = CATEGORY_STYLE[category];
  const showHero = style.showHero !== false;
  const groups = capRows(groupProducts(category, products), MAX_VARIANT_ROWS);
  const heroImageUrl = showHero ? (products.find((p) => p.hero_image_url)?.hero_image_url ?? null) : null;

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=block"
        />
        <style dangerouslySetInnerHTML={{ __html: css(style.accent, style.light, style.dark, !showHero) }} />
      </head>
      <body>
        <div className="backdrop" />
        <div className="grain" />
        <div className="page">
          <div className="eyebrow-row">
            <div className="eyebrow">BNB Store</div>
            <div className="eyebrow-line" />
          </div>

          {category === "watch" ? (
            <>
              <div className="title-sub">Apple</div>
              <h1 className="title" style={{ fontSize: 132 }}>Watch</h1>
            </>
          ) : (
            <h1 className={`title${style.upper ? " upper" : ""}`}>{style.title}</h1>
          )}
          <div className="subtitle">Originales · Garantía BNB</div>

          {heroImageUrl && (
            <div className="hero">
              <div className="hero-glow" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImageUrl} alt="" />
            </div>
          )}

          <div className="list">
            {groups.map((g) => {
              const isSimple = g.variants.length === 1 && g.variants[0].chips.length === 0;
              return (
                <div className="card" key={g.key}>
                  <div className="card-inner">
                    <div className="thumb">
                      {g.heroImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.heroImageUrl} alt="" />
                      ) : (
                        <div className="thumb-placeholder" />
                      )}
                    </div>
                    <div className="body">
                      {isSimple ? (
                        <div className="row" style={{ padding: 0 }}>
                          <div className="simple-name">{[g.brand, g.line].filter(Boolean).join(" ")}</div>
                          <div className="prices">
                            <div className="usd">{formatUsd(g.variants[0].priceUsd)}</div>
                            {usdArs != null && <div className="ars">{formatArs(g.variants[0].priceUsd * usdArs)}</div>}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="group-title">
                            {g.brand && <span className="brand">{g.brand} </span>}
                            <span className="line">{g.line}</span>
                          </div>
                          <div className="rows">
                            {g.variants.map((v) => (
                              <div className="row" key={v.id}>
                                <div className="chips">
                                  {v.chips.map((c, i) => (
                                    <span key={i} className={`chip chip-${c.kind}`}>{c.label}</span>
                                  ))}
                                </div>
                                <div className="prices">
                                  <div className="usd">{formatUsd(v.priceUsd)}</div>
                                  {usdArs != null && <div className="ars">{formatArs(v.priceUsd * usdArs)}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="footer">
            <div className="benefits">
              {BENEFITS.map((b, i) => (
                <div className="benefit" key={b}>
                  <svg viewBox="0 0 24 24">{BENEFIT_ICONS[i]}</svg>
                  <span>{b}</span>
                </div>
              ))}
            </div>
            <div className="brandfoot">
              <div className="bar" />
              <div className="logo">BNB STORE</div>
              <div className="bar" />
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
