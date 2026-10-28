/* eslint-disable @next/next/no-head-element, @next/next/google-font-display, @next/next/no-page-custom-font */
// Documento HTML completo y aislado: lo renderiza Playwright, no Next. Por eso no usa next/head ni next/font.
import type { Product } from "@/lib/types";
import type { Category } from "@/lib/types";

/** Subir cuando cambie el diseño; queda guardado en snapshot_json. */
export const BANNER_TEMPLATE_VERSION = 3;

export const BANNER_SIZE = { width: 1080, height: 1920 } as const;

/** Historia de Instagram 1080×1920. Hasta 8 productos (2 columnas × 4 filas). Se respetan las zonas seguras de IG (arriba y abajo ~200 px). */
export const BANNER_MAX_PRODUCTS = 8;

export type BannerProduct = Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url">;

export interface CategoryBannerProps {
  category: Category;
  products: BannerProduct[];
  /** Fecha ya formateada, ej. "27 de octubre" */
  dateLabel: string;
}

/** Texto y acento por categoría. Mismo lenguaje visual (negro + dorado) para toda la marca. */
export const CATEGORY_STYLE: Record<Category, { title: string; subtitle: string; eyebrow: string; accent: string; light: string; dark: string }> = {
  iphone: { title: "iPhone", subtitle: "Nuevos · Sellados · Garantía oficial", eyebrow: "Precios de hoy", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  ipad: { title: "iPad", subtitle: "Nuevos · Sellados · Garantía oficial", eyebrow: "Precios de hoy", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  macbook: { title: "MacBook", subtitle: "Nuevas · Selladas · Garantía oficial", eyebrow: "Precios de hoy", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  watch: { title: "Apple Watch", subtitle: "Nuevos · Sellados · Garantía oficial", eyebrow: "Precios de hoy", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  airpods: { title: "AirPods", subtitle: "Nuevos · Sellados · Garantía oficial", eyebrow: "Precios de hoy", accent: "#d4a640", light: "#f5d98a", dark: "#8a6a1e" },
  samsung: { title: "Samsung", subtitle: "Galaxy · Nuevos · Sellados · Garantía", eyebrow: "Precios de hoy", accent: "#8fb7ff", light: "#d6e4ff", dark: "#3b63b8" },
};

export function formatUsd(value: number): string {
  return "US$ " + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function css(accent: string, light: string, dark: string, titleSize: number) {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${BANNER_SIZE.width}px; height: ${BANNER_SIZE.height}px; overflow: hidden; }
  body { background: #000; color: #fff; font-family: "Inter", system-ui, -apple-system, sans-serif; position: relative; }
  .vignette { position: absolute; inset: 0;
    background: radial-gradient(ellipse 70% 45% at 50% -5%, ${accent}73, transparent 70%),
                radial-gradient(ellipse 60% 35% at 50% 105%, ${accent}38, transparent 70%), #000; }
  .grain { position: absolute; inset: 0; opacity: 0.08; mix-blend-mode: screen;
    background-image: radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 0.5px); background-size: 4px 4px; }
  .page { position: relative; height: 100%; padding: 170px 64px 190px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; }
  .eyebrow { font-size: 26px; font-weight: 600; letter-spacing: 0.28em; text-transform: uppercase; color: ${accent}; }
  .date { font-size: 26px; font-weight: 500; color: rgba(255,255,255,0.55); letter-spacing: 0.04em; text-align: right; }
  .title { margin-top: 28px; font-family: "Fraunces", Georgia, serif; font-weight: 900; font-size: ${titleSize}px; line-height: 0.95; letter-spacing: -0.03em;
    background: linear-gradient(180deg, ${light} 0%, ${accent} 55%, ${dark} 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; font-variation-settings: "opsz" 144, "SOFT" 50; white-space: nowrap; }
  .subtitle { margin-top: 14px; font-size: 30px; color: rgba(255,255,255,0.7); font-weight: 500; }
  .grid { margin-top: 40px; flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 20px; align-content: stretch; }
  .card { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; padding: 16px 20px;
    border-radius: 26px;
    background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
    border: 1px solid ${accent}59; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 20px 50px rgba(0,0,0,0.5); backdrop-filter: blur(12px); }
  .card::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 100% 0%, ${accent}2e, transparent 55%); }
  .hero { width: 104px; height: 150px; flex: none; flex: none; display: flex; align-items: center; justify-content: center; }
  .hero img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 16px 24px rgba(0,0,0,0.6)); }
  .hero-placeholder { width: 74px; height: 136px; border-radius: 16px; border: 2px solid rgba(255,255,255,0.18);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)); }
  .info { display: flex; flex-direction: column; min-width: 0; }
  .model { font-size: 29px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .capacity { margin-top: 4px; font-size: 22px; font-weight: 500; color: rgba(255,255,255,0.55); }
  .price { margin-top: 10px; font-family: "Fraunces", Georgia, serif; font-weight: 900; font-size: 56px; line-height: 1; letter-spacing: -0.02em;
    background: linear-gradient(180deg, ${light}, ${accent}); -webkit-background-clip: text; background-clip: text; color: transparent; white-space: nowrap; }
  .footer { margin-top: 36px; padding-top: 30px; border-top: 1px solid ${accent}4d; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .benefits { display: flex; gap: 22px; }
  .benefit { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 600; color: rgba(255,255,255,0.85); white-space: nowrap; }
  .benefit i { width: 10px; height: 10px; border-radius: 50%; background: ${accent}; box-shadow: 0 0 12px ${accent}; flex: none; }
  .brand { text-align: right; }
  .logo { font-family: "Fraunces", Georgia, serif; font-weight: 900; font-size: 60px; letter-spacing: -0.02em; line-height: 1;
    background: linear-gradient(180deg, ${light}, ${dark}); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .logo sup { font-size: 18px; vertical-align: top; position: relative; top: 4px; }
  .handle { margin-top: 6px; font-size: 22px; color: rgba(255,255,255,0.55); font-weight: 500; }
`;
}

/** Banner de precios de una categoría. Base visual compartida por todas (negro + viñeta, Fraunces 900, cards translúcidas). */
export function CategoryBanner({ category, products, dateLabel }: CategoryBannerProps) {
  const style = CATEGORY_STYLE[category];
  // Títulos largos ("Apple Watch") bajan de tamaño para no cortarse.
  const titleSize = style.title.length > 8 ? 150 : 200;
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,900,50&family=Inter:wght@500;600;700&display=block"
        />
        <style dangerouslySetInnerHTML={{ __html: css(style.accent, style.light, style.dark, titleSize) }} />
      </head>
      <body>
        <div className="vignette" />
        <div className="grain" />
        <div className="page">
          <div className="top">
            <div className="eyebrow">{style.eyebrow}</div>
            <div className="date">{dateLabel}</div>
          </div>
          <h1 className="title">{style.title}</h1>
          <div className="subtitle">{style.subtitle}</div>

          <div className="grid">
            {products.slice(0, BANNER_MAX_PRODUCTS).map((p) => (
              <div className="card" key={p.id}>
                <div className="hero">
                  {p.hero_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.hero_image_url} alt="" />
                  ) : (
                    <div className="hero-placeholder" />
                  )}
                </div>
                <div className="info">
                  <div className="model">{p.model}</div>
                  {p.capacity && <div className="capacity">{p.capacity}</div>}
                  <div className="price">{formatUsd(p.price_usd)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="footer">
            <div className="benefits">
              <div className="benefit"><i />Garantía</div>
              <div className="benefit"><i />Sellados</div>
              <div className="benefit"><i />Cuotas</div>
              <div className="benefit"><i />Envíos</div>
            </div>
            <div className="brand">
              <div className="logo">BNB<sup>®</sup></div>
              <div className="handle">@bnbstore.dolores</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
