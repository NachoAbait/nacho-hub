import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReelCaption } from "@/remotion/ReelComposition";

const WHISPER_MODEL = "whisper-1";
/** Cuántas palabras entran juntas en pantalla por tramo — estilo "karaoke" de CapCut/Opus (pocas
 * palabras grandes a la vez), no la frase completa como un subtítulo de película. */
const WORDS_PER_CHUNK = 2;

interface WhisperWord {
  word: string;
  start: number;
  end: number;
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

async function extractAudio(videoPath: string): Promise<string> {
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

async function fetchWhisperWords(audioPath: string, apiKey: string): Promise<WhisperWord[]> {
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
  const json = (await res.json()) as { words?: WhisperWord[] };
  return json.words ?? [];
}

/**
 * Transcribe el audio del clip con Whisper y arma los tramos de `ReelCaption` que
 * `ReelComposition.tsx` ya sabe animar — cada tramo trae un `size` relativo (0.9x a 1.4x) según el
 * volumen medio de esas palabras, que es el "énfasis" dinámico que pidió Nacho sin tener que
 * etiquetar nada a mano.
 *
 * Nunca tira: sin `OPENAI_API_KEY` devuelve `[]` (el render sigue sin subtítulos, como hasta ahora),
 * y cualquier error de Whisper/ffmpeg se propaga para que el caller decida (hoy: renderReel lo
 * atrapa y sigue sin captions en vez de perder el render entero).
 */
export async function transcribeToCaptions(videoPath: string, fps: number): Promise<ReelCaption[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const audioPath = await extractAudio(videoPath);
  try {
    const words = await fetchWhisperWords(audioPath, apiKey);
    if (words.length === 0) return [];

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
