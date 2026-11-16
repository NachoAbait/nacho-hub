import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";

const LOCAL_CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => Boolean(p));

async function launchBrowser(): Promise<Browser> {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (serverless) {
    // Chromium recortado para Lambda/Vercel. Solo existe en linux.
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }

  const executablePath = LOCAL_CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error(
      "No encontré Chrome para renderizar en local. Instalá Google Chrome o seteá CHROME_PATH en .env.local",
    );
  }
  return chromium.launch({ executablePath, headless: true });
}

export interface RenderSize {
  width: number;
  height: number;
}

/** Renderiza un documento HTML completo a PNG del tamaño exacto pedido. */
export async function renderHtmlToPng(html: string, size: RenderSize): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    // networkidle espera a que bajen fuentes de Google e imágenes hero.
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, ...size },
    });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}

/**
 * Para templates como el de CategoryBanner, que recortan contenido a un número fijo de filas para
 * entrar en el cuadro: en vez de calibrar ese número a mano (y que se desactualice cada vez que
 * cambia el CSS del banner — así se coló el bug de precios cortados), renderiza de verdad con cada
 * candidato y mide si alguna `.card` recorta su propio contenido (overflow: hidden + flexbox
 * achicando cards cuando no entran todas). Busca binario el máximo de filas que entra sin recortar
 * nada — asume que menos filas nunca generan MÁS recorte que más filas, así que sirve buscar así.
 */
export async function renderFittedBanner(
  buildHtml: (maxRows: number) => string,
  size: RenderSize,
  maxPossibleRows: number,
): Promise<{ png: Buffer; rowsUsed: number }> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });

    async function fits(maxRows: number): Promise<boolean> {
      await page.setContent(buildHtml(maxRows), { waitUntil: "networkidle", timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      return page.evaluate(() => {
        const cards = document.querySelectorAll(".card");
        return Array.from(cards).every((c) => c.scrollHeight <= c.clientHeight + 1);
      });
    }

    const hi0 = Math.max(1, maxPossibleRows);
    let best: number;
    // Caso común (la gran mayoría de las categorías): el catálogo entero ya entra sin recortar nada
    // — un solo render, el mismo costo que antes de este cambio. Solo las categorías con muchos
    // modelos (ver bug de iPhone) pagan la búsqueda binaria de abajo; en serverless, repetir
    // page.setContent de más en TODAS las categorías agota tiempo/memoria y Chromium termina
    // tirando "Unable to capture screenshot" en las últimas — por eso este atajo no es opcional.
    if (await fits(hi0)) {
      best = hi0;
    } else {
      let lo = 1;
      let hi = hi0 - 1;
      best = 1; // si ni 1 fila entra (no debería pasar), mejor mostrar algo apretado que nada.
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await fits(mid)) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      await fits(best); // deja la page cargada con el HTML ganador para la captura final
    }

    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, ...size } });
    return { png: Buffer.from(png), rowsUsed: best };
  } finally {
    await browser.close();
  }
}
