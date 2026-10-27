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
