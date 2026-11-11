import sharp from "sharp";

/** Algunos renders del CDN de Apple ya traen partes transparentes de fábrica (la "tarjeta" del
 * estudio no ocupa el lienzo entero) Y el resto del fondo con un degradé sutil, no un color plano.
 * Flood-fill desde el borde con dos reglas: contra el VECINO (tolera el degradé paso a paso, se
 * frena en el contorno del producto) y contra un color de referencia GLOBAL (el primer píxel
 * opaco que encuentra en el borde — nunca la esquina sola, que puede ser una de las partes ya
 * transparentes). Al expandir desde un píxel YA transparente no hay vecino válido con qué
 * comparar, así que ahí solo se exige la regla global. No hace nada si la imagen ya era 100%
 * transparente. Al final recorta al borde real de lo opaco (`.trim()`): si no, un lienzo con mucho
 * margen vacío alrededor hace que el producto se vea chiquito en la card (`object-fit: contain`
 * escala según el tamaño de la imagen entera, no del sujeto). */
export async function cutoutBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const idx = (x: number, y: number) => (y * width + x) * channels;
  const LOCAL_STEP = 20;
  const GLOBAL_CAP = 60;
  let cr = 245, cg = 245, cb = 247;
  findRef: for (let x = 0; x < width; x++) {
    const i = idx(x, 0);
    if (data[i + 3] >= 10) { cr = data[i]; cg = data[i + 1]; cb = data[i + 2]; break findRef; }
  }
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const propagate = (x: number, y: number, wasTransparent: boolean, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    const i = idx(x, y);
    const a = data[i + 3];
    if (a < 10) { visited[p] = 1; stack.push(x, y); return; }
    const gr = data[i] - cr, gg = data[i + 1] - cg, gb = data[i + 2] - cb;
    if (Math.sqrt(gr * gr + gg * gg + gb * gb) >= GLOBAL_CAP) return;
    if (!wasTransparent) {
      const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= LOCAL_STEP) return;
    }
    visited[p] = 1;
    stack.push(x, y);
  };
  const seedBorder = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) { seedBorder(x, 0); seedBorder(x, height - 1); }
  for (let y = 0; y < height; y++) { seedBorder(0, y); seedBorder(width - 1, y); }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const i = idx(x, y);
    const wasTransparent = data[i + 3] < 10;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i + 3] = 0;
    propagate(x + 1, y, wasTransparent, r, g, b); propagate(x - 1, y, wasTransparent, r, g, b);
    propagate(x, y + 1, wasTransparent, r, g, b); propagate(x, y - 1, wasTransparent, r, g, b);
  }
  return sharp(data, { raw: { width, height, channels } }).trim().png().toBuffer();
}

/** Para productos blancos sobre el estudio blanco de Apple (AirPods, salvo Max): el flood-fill de
 * `cutoutBackground` no puede distinguir el producto del fondo cuando los dos son casi el mismo
 * blanco — termina perforando el cuerpo del producto en vez de limpiar el fondo. Acá no se intenta
 * transparencia, solo se recorta el margen blanco sobrante alrededor (mismo problema de "se ve
 * chiquito" que resuelve `.trim()` en cutoutBackground). El resultado queda con un fondo blanco
 * liso, no transparente — visualmente una placa blanca redondeada, aceptable para este caso. */
export async function trimOnly(buf: Buffer): Promise<Buffer> {
  return sharp(buf).trim().png().toBuffer();
}
