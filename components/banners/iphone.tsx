/* eslint-disable @next/next/no-head-element, @next/next/google-font-display, @next/next/no-page-custom-font */
// Documento HTML completo y aislado: lo renderiza Playwright, no Next. Por eso no usa next/head ni next/font.
import type { Product } from "@/lib/types";

/** Subir cuando cambie el diseño; queda guardado en snapshot_json. */
export const IPHONE_TEMPLATE_VERSION = 1;

export const IPHONE_BANNER_SIZE = { width: 1080, height: 1350 } as const;

export interface IphoneBannerProps {
  products: Pick<Product, "id" | "model" | "capacity" | "price_usd" | "hero_image_url">[];
  /** Fecha ya formateada, ej. "27 de octubre" */
  dateLabel: string;
}

const GOLD = "#d4a640";
const GOLD_LIGHT = "#f5d98a";
const GOLD_DARK = "#8a6a1e";

export function formatUsd(value: number): string {
  return "US$ " + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${IPHONE_BANNER_SIZE.width}px; height: ${IPHONE_BANNER_SIZE.height}px; overflow: hidden; }
  body {
    background: #000;
    color: #fff;
    font-family: "Inter", system-ui, -apple-system, sans-serif;
    position: relative;
  }
  .vignette {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 70% 45% at 50% -5%, rgba(212,166,64,0.45), transparent 70%),
      radial-gradient(ellipse 60% 35% at 50% 105%, rgba(212,166,64,0.22), transparent 70%),
      #000;
  }
  .grain {
    position: absolute; inset: 0; opacity: 0.08; mix-blend-mode: screen;
    background-image: radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 0.5px);
    background-size: 4px 4px;
  }
  .page { position: relative; height: 100%; padding: 64px 64px 56px; display: flex; flex-direction: column; }

  .top { display: flex; align-items: flex-start; justify-content: space-between; }
  .eyebrow { font-size: 22px; font-weight: 600; letter-spacing: 0.28em; text-transform: uppercase; color: ${GOLD}; }
  .date { font-size: 22px; font-weight: 500; color: rgba(255,255,255,0.55); letter-spacing: 0.04em; text-align: right; }

  .title {
    margin-top: 10px;
    font-family: "Fraunces", Georgia, serif;
    font-weight: 900;
    font-size: 148px;
    line-height: 0.95;
    letter-spacing: -0.03em;
    background: linear-gradient(180deg, ${GOLD_LIGHT} 0%, ${GOLD} 55%, ${GOLD_DARK} 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-variation-settings: "opsz" 144, "SOFT" 50;
  }
  .subtitle { margin-top: 8px; font-size: 26px; color: rgba(255,255,255,0.7); font-weight: 500; }

  .grid {
    margin-top: 44px; flex: 1;
    display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 22px;
    align-content: stretch;
  }
  .card {
    position: relative; overflow: hidden;
    display: flex; align-items: center; gap: 18px;
    padding: 22px 24px;
    min-height: 196px;
    border-radius: 28px;
    background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
    border: 1px solid rgba(212,166,64,0.35);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 20px 50px rgba(0,0,0,0.5);
    backdrop-filter: blur(12px);
  }
  .card::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 100% 0%, rgba(212,166,64,0.18), transparent 55%);
  }
  .hero { width: 120px; height: 170px; flex: none; display: flex; align-items: center; justify-content: center; }
  .hero img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 16px 24px rgba(0,0,0,0.6)); }
  .hero-placeholder {
    width: 72px; height: 140px; border-radius: 16px;
    border: 2px solid rgba(255,255,255,0.18);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  }
  .info { display: flex; flex-direction: column; min-width: 0; }
  .model { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .capacity { margin-top: 4px; font-size: 20px; font-weight: 500; color: rgba(255,255,255,0.55); }
  .price {
    margin-top: 14px;
    font-family: "Fraunces", Georgia, serif;
    font-weight: 900; font-size: 56px; line-height: 1; letter-spacing: -0.02em;
    background: linear-gradient(180deg, ${GOLD_LIGHT}, ${GOLD});
    -webkit-background-clip: text; background-clip: text; color: transparent;
    white-space: nowrap;
  }

  .footer { margin-top: 36px; padding-top: 28px; border-top: 1px solid rgba(212,166,64,0.3);
    display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .benefits { display: flex; gap: 28px; }
  .benefit { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 600; color: rgba(255,255,255,0.85); white-space: nowrap; }
  .benefit i { width: 10px; height: 10px; border-radius: 50%; background: ${GOLD}; box-shadow: 0 0 12px ${GOLD}; flex: none; }
  .brand { text-align: right; }
  .logo {
    font-family: "Fraunces", Georgia, serif; font-weight: 900; font-size: 48px; letter-spacing: -0.02em; line-height: 1;
    background: linear-gradient(180deg, ${GOLD_LIGHT}, ${GOLD_DARK});
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .logo sup { font-size: 18px; vertical-align: top; position: relative; top: 4px; }
  .handle { margin-top: 6px; font-size: 18px; color: rgba(255,255,255,0.55); font-weight: 500; }
`;

export function IphoneBanner({ products, dateLabel }: IphoneBannerProps) {
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
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div className="vignette" />
        <div className="grain" />
        <div className="page">
          <div className="top">
            <div className="eyebrow">Precios de hoy</div>
            <div className="date">{dateLabel}</div>
          </div>
          <h1 className="title">iPhone</h1>
          <div className="subtitle">Nuevos · Sellados · Garantía oficial</div>

          <div className="grid">
            {products.map((p) => (
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
