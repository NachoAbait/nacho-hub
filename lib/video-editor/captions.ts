import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReelCaption } from "@/remotion/ReelComposition";

const WHISPER_MODEL = "whisper-1";
/** Una palabra por tramo — probado en vivo con 2: cortaba la frase en pedazos sin sentido ("16 EL"
 * cuando la frase real era "...el iPhone 16, el 17 Pro..."). Una por vez es el estilo karaoke real
 * (CapCut/Opus/Submagic lo hacen así), y nunca se parte una palabra a la mitad. */
const WORDS_PER_CHUNK = 1;

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
    if (endsSentence || longPauseAfter) flush();
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
 * Arma los tramos de `ReelCaption` que `ReelComposition.tsx` ya sabe animar a partir de las
 * palabras de la transcripción — cada tramo trae un `size` relativo (0.9x a 1.4x) según el volumen
 * medio de esas palabras en el audio ORIGINAL (necesita `videoPath` de nuevo porque el tamaño se
 * calcula sobre el audio, no sobre el texto), que es el "énfasis" dinámico que pidió Nacho sin tener
 * que etiquetar nada a mano.
 */
export async function buildCaptions(videoPath: string, words: WhisperWord[], fps: number): Promise<ReelCaption[]> {
  if (words.length === 0) return [];

  const audioPath = await extractAudio(videoPath);
  try {
    const chunks: WhisperWord[][] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) chunks.push(words.slice(i, i + WORDS_PER_CHUNK));

    const volumes = await Promise.all(chunks.map((chunk) => meanVolumeDb(audioPath, chunk[0].start, chunk[chunk.length - 1].end)));
    const finite = volumes.filter((v) => Number.isFinite(v));
    const min = finite.length ? Math.min(...finite) : -40;
    const max = finite.length ? Math.max(...finite) : -10;
    const range = Math.max(max - min, 1);

    return chunks.map((chunk, i) => {
      const vol = Number.isFinite(volumes[i]) ? volumes[i] : min;
      const loudness = (vol - min) / range; // 0 (más flojo del clip) .. 1 (más fuerte)
      const size = Number((0.9 + loudness * 0.5).toFixed(2)); // 0.9x..1.4x
      return {
        text: chunk.map((w) => w.word.trim()).join(" "),
        startFrame: Math.round(chunk[0].start * fps),
        endFrame: Math.round(chunk[chunk.length - 1].end * fps),
        size,
      };
    });
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}
