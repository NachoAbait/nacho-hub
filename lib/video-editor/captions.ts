import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReelPhrase } from "@/remotion/ReelComposition";

const WHISPER_MODEL = "whisper-1";

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

/** Tramo a nivel oración — es lo que le pasamos a Claude en content-analysis.ts: analizar oración
 * por oración es mucho más preciso que analizar palabra por palabra, y mucho más barato que mandarle
 * el audio entero. Lo armamos nosotros a partir de las palabras (ver sentenceSegmentsFromWords),
 * NO con el array `segments` nativo de Whisper: ese viene cortado por ventanas de decodificación
 * internas de ~30s, no por oración — en un clip corto puede devolver un solo segmento gigante que
 * mezcla varias oraciones (y varios productos/tonos) en uno solo. */
export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

/** Whisper no siempre pone punto donde de verdad termina una idea (sobre todo en audio hablado
 * casual, sin la prosodia clara de una lectura) — probado en vivo: una frase entera con comas
 * seguidas y un solo punto al final. Por eso, además de la puntuación, se corta también cuando hay
 * un silencio real entre una palabra y la siguiente (>0.45s) — eso sí marca de forma confiable un
 * cambio de idea aunque la transcripción no haya puesto el punto. */
const PAUSE_THRESHOLD_SECONDS = 0.45;

/** Tope duro además de puntuación/pausa — pedido explícito: "andá de una oración en una oración...
 * no un texto que se va cargando de a poco". Alguien hablando corrido sin comas ni pausas reales
 * podía armar un solo segmento gigante (varias ideas, varios productos) que en pantalla se sentía
 * como un párrafo completándose en vez de una oración a la vez. Con esto se corta igual aunque no
 * haya pausa ni puntuación — no es perfecto (puede cortar en medio de una idea), pero mantiene cada
 * frase en pantalla corta y legible, que es lo que se pidió.
 *
 * Bajado de 11 a 7 el 26-11-2026 — pedido explícito: "no quiero que aparezcan más de 6/7 palabras en
 * una oración". MAX_SEGMENT_SECONDS también bajó en la misma proporción (7 palabras habladas a ritmo
 * normal no necesitan 4.5s en pantalla). */
const MAX_SEGMENT_WORDS = 7;
const MAX_SEGMENT_SECONDS = 3;

/** Si el tope de arriba cae justo antes de uno de estos, se espera una palabra más — sin esto, "el
 * 14 Pro" se cortaba en "el 14" y "Pro" quedaba solo, como su propia frase de una sola palabra en
 * pantalla (visto en vivo con un clip real: "PRO" solo, 1.4s). */
const DEFERRABLE_MODIFIERS = new Set(["pro", "max", "plus", "mini"]);

function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-záéíóúñ]/g, "");
}

/** Corta en tramos de oración/frase usando los timestamps reales de cada palabra — a diferencia del
 * `segments` nativo de Whisper (cortado por ventanas de decodificación de ~30s, no por idea), esto da
 * un tramo por cada pausa o punto real, así Claude puede clasificar producto/tono por cada uno en vez
 * de por un bloque gigante que mezcla varios productos y tonos distintos. */
function sentenceSegmentsFromWords(words: WhisperWord[]): WhisperSegment[] {
  const segments: WhisperSegment[] = [];
  let buffer: WhisperWord[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({ start: buffer[0].start, end: buffer[buffer.length - 1].end, text: buffer.map((w) => w.word.trim()).join(" ") });
    buffer = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    buffer.push(word);
    const endsSentence = /[.!?]\s*$/.test(word.word);
    const nextWord = words[i + 1];
    const longPauseAfter = nextWord ? nextWord.start - word.end > PAUSE_THRESHOLD_SECONDS : false;
    const tooLong = buffer.length >= MAX_SEGMENT_WORDS || word.end - buffer[0].start > MAX_SEGMENT_SECONDS;
    // Se aplica a CUALQUIER motivo de corte, no solo al tope de palabras: la pausa real que alguien
    // hace entre "14" y "Pro" al hablar también disparaba el corte y separaba igual (visto en vivo).
    const nextIsDeferrableModifier = nextWord ? DEFERRABLE_MODIFIERS.has(normalizeWord(nextWord.word)) : false;
    if ((endsSentence || longPauseAfter || tooLong) && !nextIsDeferrableModifier) flush();
  }
  flush();

  return segments;
}

export interface Transcript {
  words: WhisperWord[];
  segments: WhisperSegment[];
  text: string;
}

function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg salió con código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function extractAudio(videoPath: string): Promise<string> {
  const audioPath = path.join(os.tmpdir(), `video-editor-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await runFfmpeg(["-y", "-i", videoPath, "-ac", "1", "-ar", "16000", "-vn", audioPath]);
  return audioPath;
}

/** Whisper no expone volumen ni confianza por palabra — lo único que tenemos para aproximar
 * "énfasis" es medir el volumen real del audio en la ventana de esa palabra. `mean_volume` sale del
 * filtro `volumedetect` de ffmpeg, que lo imprime por stderr (no hay forma de pedirlo por stdout). */
async function meanVolumeDb(audioPath: string, start: number, end: number): Promise<number> {
  const duration = Math.max(end - start, 0.05);
  const { stderr } = await runFfmpeg([
    "-y",
    "-ss", start.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", audioPath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  return match ? parseFloat(match[1]) : Number.NEGATIVE_INFINITY;
}

/** Un solo llamado a Whisper nos da palabras (para los subtítulos) Y oraciones (para que Claude
 * analice de qué producto habla cada una y con qué tono) — pedir las dos cosas por separado sería
 * pagar la transcripción dos veces por el mismo clip. */
async function fetchWhisperTranscript(audioPath: string, apiKey: string): Promise<Transcript> {
  const buf = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/wav" }), "audio.wav");
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { words?: WhisperWord[]; text?: string };
  const words = json.words ?? [];
  return { words, segments: sentenceSegmentsFromWords(words), text: json.text ?? "" };
}

/**
 * Transcribe el audio del clip entero una sola vez. Nunca tira por falta de credencial: sin
 * `OPENAI_API_KEY` devuelve `null` (el caller sigue sin subtítulos ni detección de producto/tono,
 * como antes de esta fase). Un error real de Whisper/ffmpeg SÍ se propaga para que el caller decida.
 */
export async function transcribeClip(videoPath: string): Promise<Transcript | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const audioPath = await extractAudio(videoPath);
  try {
    return await fetchWhisperTranscript(audioPath, apiKey);
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}

/**
 * Arma las frases (`ReelPhrase`) que `ReelComposition.tsx` ya sabe animar — una por `WhisperSegment`
 * (oración/frase real, ver sentenceSegmentsFromWords), cada una con sus palabras en orden. En
 * pantalla la frase se va completando palabra por palabra en vez de reemplazarse una a la otra
 * (pedido explícito: "que la oración se va completando a medida que hablo").
 *
 * Cada palabra trae un `size` relativo (0.9x a 1.4x) según el volumen medio de esa palabra en el
 * audio ORIGINAL (necesita `videoPath` de nuevo porque se mide sobre el audio, no sobre el texto) —
 * variación chica y "orgánica", aparte del salto grande de `level` (ver `levels` abajo).
 *
 * `levels`, si se pasa, trae la clasificación semántica de lib/video-editor/caption-style.ts, UN
 * valor por cada entrada de `words` (mismo orden/largo) — "normal" para todas si no se pasa nada.
 */
export async function buildPhrases(
  videoPath: string,
  words: WhisperWord[],
  segments: WhisperSegment[],
  fps: number,
  levels?: ("normal" | "keyword" | "critical")[],
): Promise<ReelPhrase[]> {
  if (words.length === 0 || segments.length === 0) return [];

  const audioPath = await extractAudio(videoPath);
  try {
    const volumes = await Promise.all(words.map((w) => meanVolumeDb(audioPath, w.start, w.end)));
    const finite = volumes.filter((v) => Number.isFinite(v));
    const min = finite.length ? Math.min(...finite) : -40;
    const max = finite.length ? Math.max(...finite) : -10;
    const range = Math.max(max - min, 1);
    const sizes = volumes.map((vol) => {
      const v = Number.isFinite(vol) ? vol : min;
      const loudness = (v - min) / range; // 0 (más flojo del clip) .. 1 (más fuerte)
      return Number((0.9 + loudness * 0.5).toFixed(2)); // 0.9x..1.4x
    });

    const EPS = 0.05;
    let nextWordIdx = 0;
    const phrases: ReelPhrase[] = [];
    for (const seg of segments) {
      const segWords: ReelPhrase["words"] = [];
      // `.end`, no `.start`: cuando dos oraciones quedan pegadas sin pausa real entre sí (el tope de
      // palabras/segundos de sentenceSegmentsFromWords puede cortar ahí aunque no haya silencio), el
      // `start` de la primera palabra de la oración SIGUIENTE puede caer dentro del margen EPS del
      // `end` de la oración ANTERIOR — esa palabra se la "robaba" la oración anterior, dejando a la
      // oración siguiente con una palabra menos (visto en vivo: "Pro" quedó solo, sin su "14").
      // Comparar contra `.end` de la palabra evita esto: la última palabra real de un segmento
      // siempre termina justo en `seg.end` (así se construyó en sentenceSegmentsFromWords), así que
      // el margen EPS solo cubre redondeo, no le alcanza para robarse la primera palabra de la
      // oración de al lado.
      while (nextWordIdx < words.length && words[nextWordIdx].end <= seg.end + EPS) {
        const w = words[nextWordIdx];
        if (w.start >= seg.start - EPS) {
          segWords.push({
            text: w.word.trim(),
            startFrame: Math.round(w.start * fps),
            size: sizes[nextWordIdx],
            level: levels?.[nextWordIdx] ?? "normal",
          });
        }
        nextWordIdx++;
      }
      if (segWords.length > 0) {
        phrases.push({ startFrame: Math.round(seg.start * fps), endFrame: Math.round(seg.end * fps), words: segWords });
      }
    }
    return phrases;
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}
