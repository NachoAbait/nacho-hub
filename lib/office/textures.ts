"use client";

import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace } from "three";

/** Generador determinista para que las texturas sean iguales en cada carga. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: [number, number, number], k: number): string {
  return `rgb(${Math.min(255, r * k) | 0}, ${Math.min(255, g * k) | 0}, ${Math.min(255, b * k) | 0})`;
}

function texture(canvas: HTMLCanvasElement, repeat: [number, number]): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** Parquet: tablones desfasados con veta y variación de tono. */
export function woodTexture(baseHex: string, repeat: [number, number], seed = 1): CanvasTexture {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const base = hexToRgb(baseHex);
  const rand = rng(seed);
  const rows = 8;
  const plankH = size / rows;
  const plankW = size / 2;

  ctx.fillStyle = shade(base, 1);
  ctx.fillRect(0, 0, size, size);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (plankW / 2);
    for (let x = -plankW; x < size + plankW; x += plankW) {
      const px = x + offset;
      const tone = 0.82 + rand() * 0.36;
      ctx.fillStyle = shade(base, tone);
      ctx.fillRect(px, r * plankH, plankW - 2, plankH - 2);
      // veta
      ctx.strokeStyle = shade(base, tone * 0.8);
      ctx.lineWidth = 1;
      for (let v = 0; v < 6; v++) {
        const y = r * plankH + rand() * plankH;
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.bezierCurveTo(px + plankW * 0.3, y + rand() * 6 - 3, px + plankW * 0.6, y + rand() * 6 - 3, px + plankW, y + rand() * 4 - 2);
        ctx.stroke();
      }
      // junta
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(px + plankW - 2, r * plankH, 2, plankH);
    }
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, r * plankH + plankH - 2, size, 2);
  }
  return texture(c, repeat);
}

/** Ciudad de noche para las ventanas: edificios con ventanitas encendidas. */
export function cityTexture(seed = 7): CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const rand = rng(seed);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#07101f");
  sky.addColorStop(0.7, "#132447");
  sky.addColorStop(1, "#1d3561");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // luna
  ctx.fillStyle = "rgba(255,245,220,0.9)";
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.22, 22, 0, Math.PI * 2);
  ctx.fill();

  for (let layer = 0; layer < 2; layer++) {
    let x = 0;
    while (x < w) {
      const bw = 40 + rand() * 90;
      const bh = h * (layer === 0 ? 0.25 + rand() * 0.3 : 0.4 + rand() * 0.45);
      ctx.fillStyle = layer === 0 ? "#0b1326" : "#060b16";
      ctx.fillRect(x, h - bh, bw, bh);
      // ventanas
      for (let wy = h - bh + 8; wy < h - 6; wy += 11) {
        for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
          if (rand() < 0.45) {
            ctx.fillStyle = rand() < 0.8 ? "rgba(255,220,150,0.85)" : "rgba(170,210,255,0.8)";
            ctx.fillRect(wx, wy, 5, 6);
          }
        }
      }
      x += bw + 4 + rand() * 10;
    }
  }
  const t = texture(c, [1, 1]);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}

/** Pantalla de monitor: fondo oscuro con un "dashboard" de barras y líneas. */
export function screenTexture(accentHex: string, seed = 3): CanvasTexture {
  const w = 512;
  const h = 320;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const rand = rng(seed);
  ctx.fillStyle = "#0e1420";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#17202f";
  ctx.fillRect(0, 0, w, 36);
  ctx.fillStyle = accentHex;
  ctx.fillRect(16, 12, 60, 12);
  // tarjetas
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = "#19233a";
    ctx.fillRect(16 + i * 164, 56, 148, 70);
    ctx.fillStyle = accentHex;
    ctx.fillRect(28 + i * 164, 96, 60 + rand() * 60, 10);
  }
  // gráfico
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 16; x < w - 16; x += 24) {
    const y = 300 - rand() * 130;
    if (x === 16) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // líneas de texto
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 4; i++) ctx.fillRect(16, 150 + i * 16, 120 + rand() * 180, 6);
  const t = texture(c, [1, 1]);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}
