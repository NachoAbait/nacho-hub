import type { WhisperWord } from "@/lib/video-editor/captions";

/**
 * "89 por ciento" (o "ochenta y nueve por ciento") en el subtítulo tiene que leerse "89%" — pedido
 * explícito de Nacho (26-11-2026). Whisper a veces ya transcribe el número en dígitos, a veces lo
 * deletrea — este parser cubre ambos casos para 0-999 (rango de sobra para un porcentaje). Es
 * "mejor esfuerzo", no un parser numérico completo: si no reconoce la forma exacta, deja las
 * palabras como vinieron en vez de romper nada.
 */

function normalize(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const UNITS: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};
const TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
};
const TWENTIES: Record<string, number> = {
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

/** Intenta leer un número (dígitos o deletreado) arrancando en `tokens[i]`. Devuelve cuántos tokens
 * consumió, o null si ahí no empieza ningún número reconocible. */
function parseNumberAt(tokens: string[], i: number): { value: number; consumed: number } | null {
  const t0 = tokens[i];
  if (t0 === undefined) return null;

  if (/^\d+$/.test(t0)) return { value: parseInt(t0, 10), consumed: 1 };

  if (t0 in HUNDREDS) {
    const base = HUNDREDS[t0];
    // "ciento veinte", "doscientos cincuenta y nueve" — el resto (0-99) sigue sin "y" después de la
    // centena (distinto de la unión decena+unidad, que sí usa "y").
    const rest = parseNumberAt(tokens, i + 1);
    if (rest && rest.value < 100 && base % 100 === 0) return { value: base + rest.value, consumed: 1 + rest.consumed };
    return { value: base, consumed: 1 };
  }
  if (t0 in TENS) {
    const base = TENS[t0];
    if (tokens[i + 1] === "y" && tokens[i + 2] in UNITS) return { value: base + UNITS[tokens[i + 2]], consumed: 3 };
    return { value: base, consumed: 1 };
  }
  if (t0 in TWENTIES) return { value: TWENTIES[t0], consumed: 1 };
  if (t0 in TEENS) return { value: TEENS[t0], consumed: 1 };
  if (t0 in UNITS) return { value: UNITS[t0], consumed: 1 };

  return null;
}

/** Tras un número, ¿sigue "por ciento" (dos tokens) o "porciento" (uno)? Devuelve cuántos tokens más
 * consume esa frase, o null si no matchea. */
function parsePorCientoAt(tokens: string[], i: number): number | null {
  if (tokens[i] === "porciento") return 1;
  if (tokens[i] === "por" && tokens[i + 1] === "ciento") return 2;
  return null;
}

export function mergePercentWords(words: WhisperWord[]): WhisperWord[] {
  if (words.length === 0) return words;
  const tokens = words.map((w) => normalize(w.word));
  const out: WhisperWord[] = [];

  let i = 0;
  while (i < words.length) {
    const num = parseNumberAt(tokens, i);
    if (num) {
      const porCiento = parsePorCientoAt(tokens, i + num.consumed);
      if (porCiento !== null) {
        const lastIdx = i + num.consumed + porCiento - 1;
        out.push({ word: `${num.value}%`, start: words[i].start, end: words[lastIdx].end });
        i = lastIdx + 1;
        continue;
      }
      // Caso visto en vivo (28-11-2026): Whisper ya escribe "85%" en el texto completo del clip, pero
      // en el array de PALABRAS el símbolo "%" sale como su propio token con texto vacío/en blanco
      // pegado al número (en vez de venir deletreado "por ciento", que es el único caso que cubre el
      // bloque de arriba) — sin este caso, el subtítulo mostraba "85" solo, sin el signo. Un token de
      // texto vacío justo después de un número puro es ese símbolo perdido.
      const after = tokens[i + num.consumed];
      if (after === "" && words[i + num.consumed] !== undefined) {
        const lastIdx = i + num.consumed;
        out.push({ word: `${num.value}%`, start: words[i].start, end: words[lastIdx].end });
        i = lastIdx + 1;
        continue;
      }
    }
    out.push(words[i]);
    i++;
  }
  return out;
}
