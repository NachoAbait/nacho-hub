/**
 * Captura la oficina 3D en headless Chrome para revisar el diseño.
 *   npx tsx scripts/shot-office.ts http://localhost:3077 /ruta/salida
 * Genera salida-bnb/agro/ambos/sector/panel.png
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3077";
const out = process.argv[3] ?? "office";
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.CHROME_PATH].find((p) => p && existsSync(p));

async function main() {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}-bnb.png` });

  await page.getByRole("button", { name: "AgroScan" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-agro.png` });

  await page.getByRole("button", { name: "Ambos" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-ambos.png` });

  await page.getByRole("button", { name: "BNB" }).click();
  await page.waitForTimeout(2500);
  // click en el centro del canvas para probar selección (cae en algún escritorio o en el piso)
  // zoom a un sector: click en la alfombra de Analysts (a la derecha, entre escritorios)
  const sign = await page.getByText("Equipo Analysts", { exact: true }).first().boundingBox();
  if (sign) await page.mouse.click(sign.x + sign.width / 2 - 40, sign.y + sign.height + 150);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-sector.png` });

  // volver y abrir el panel de un agente
  await page.getByRole("button", { name: /volver al piso/ }).click();
  await page.waitForTimeout(2200);
  const label = await page.getByText("Designer", { exact: true }).first().boundingBox();
  if (label) await page.mouse.click(label.x + label.width / 2, label.y + label.height + 22);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-panel.png` });

  console.log("errores de consola:", errors.length ? errors : "ninguno");
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
