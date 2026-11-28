import { spawn } from "node:child_process";
import path from "node:path";
import { VIDEO_EDITOR_TMP_DIR } from "@/lib/video-editor/render";

/** Umbral de referencia para `detectSilences` cuando se usa como CHEQUEO (ver qc.ts) — no se usa para
 * cortar nada acá (ver nota de `cutSilences` abajo sobre el pedido de no tocar pausas de en medio). */
const MIN_SILENCE_SECONDS = 1.0;
/** El silencio ANTES de la primera palabra es otra cosa: no es una pausa natural entre ideas (ahí
 * todavía no hay nadie hablando), es tiempo muerto quieto mirando a cámara antes de arrancar. Se
 * evalúa con un umbral muy bajo — pedido explícito (27-11-2026): "cortá milisegundos antes de
 * comenzar a hablar, que casi no haya silencios". */
const LEADING_SILENCE_MIN_SECONDS = 0.03;
/** Nivel por debajo del cual ffmpeg considera "silencio" — no es 0 absoluto, ruido de ambiente/mic
 * real nunca llega a -∞dB. */
const SILENCE_NOISE_DB = "-30dB";
/** Margen que se deja pegado a cada punta (al final del silencio inicial, y al principio del
 * silencio final) para no comerse el ataque de la primera palabra ni el final de la última. Chico
 * porque de ese lado no hay habla real que proteger, solo el borde del propio corte — pedido explícito
 * (27-11-2026): "milisegundos antes de comenzar a hablar"; (28-11-2026): "ni bien termino de hablar...
 * pero justito justito". Mismo valor para las dos puntas, no hay motivo para que sean distintas. */
const EDGE_PAD_SECONDS = 0.04;

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} salió con código ${code}: ${stderr.slice(-500)}`))));
  });
}

async function probeDuration(videoPath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = parseFloat(stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

export interface SilenceWindow {
  start: number;
  end: number;
}

/** Corre `silencedetect` de ffmpeg y devuelve los tramos de silencio de al menos `minSeconds`
 * encontrados en el clip. Exportado aparte (no solo usado por `cutSilences` abajo) para que qc.ts
 * pueda reusarlo y confirmar, sobre el video YA cortado, que no quedó ningún silencio largo sin
 * cortar — es el mismo chequeo, aplicado como verificación en vez de como corte. */
export async function detectSilences(videoPath: string, minSeconds = MIN_SILENCE_SECONDS): Promise<SilenceWindow[]> {
  const duration = await probeDuration(videoPath);
  if (duration <= 0) return [];

  const { stderr } = await run("ffmpeg", [
    "-i", videoPath,
    "-af", `silencedetect=noise=${SILENCE_NOISE_DB}:d=${minSeconds}`,
    "-f", "null", "-",
  ]);

  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const windows: SilenceWindow[] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) windows.push({ start: starts[i], end: ends[i] });
  // Un silence_start sin su silence_end (el clip termina en silencio) cierra al final del clip.
  if (starts.length > ends.length) windows.push({ start: starts[starts.length - 1], end: duration });
  return windows;
}

export interface SilenceCutResult {
  /** Mismo path de entrada si no había nada que cortar (nunca se re-encodea sin necesidad). */
  path: string;
  cutsApplied: number;
  secondsRemoved: number;
}

/**
 * Primer paso del pipeline, antes de cualquier otra edición. Recorta el silencio en LAS DOS PUNTAS del
 * clip — antes de la primera palabra Y después de la última (tiempo muerto quieto a cámara, antes de
 * arrancar o después de terminar de hablar) — pedido explícito (27-11-2026): "corta los clips
 * milisegundos antes de comenzar a hablar... que casi no haya silencios"; (28-11-2026, sobre el mismo
 * pedido no cumplido del todo): "tenes que cortar los clips! ni bien termino de hablar en uno, y ni
 * bien arranco a hablar en el proximo, pero justito justito". Nunca toca nada que esté ADENTRO del
 * clip (pedido explícito 27-11-2026: "no me cortes adentro de un mismo clip") — antes de esa fecha
 * esta función también cortaba pausas ≥1s en medio de una misma toma (MIN_SILENCE_SECONDS); se sacó
 * esa parte por ese pedido y sigue sin tocarse acá. `detectSilences` (abajo) sigue existiendo tal cual
 * para quien quiera ese chequeo más general (ver qc.ts), que es informativo y no corta nada.
 *
 * Como esto corre ANTES de transcribir con Whisper, todo lo que viene después (subtítulos, ventanas de
 * producto) ya trabaja sobre la línea de tiempo del video YA recortado — no hace falta reproyectar
 * ningún timestamp.
 *
 * Nunca tira: si ffmpeg/ffprobe fallan, o no hay silencio en ninguna punta que cortar, devuelve el
 * path original sin tocar — el caller sigue con el clip completo en vez de perder el render.
 */
export async function cutSilences(videoPath: string): Promise<SilenceCutResult> {
  try {
    const duration = await probeDuration(videoPath);
    if (duration <= 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const silences = await detectSilences(videoPath, LEADING_SILENCE_MIN_SECONDS);
    const leading = silences[0];
    const trailing = silences[silences.length - 1];

    // Solo cuenta si arranca de verdad en 0 (silence_start puede no ser exactamente 0 por redondeo de
    // ffmpeg) — si no, es una pausa más adelante en el clip, y esa no se toca (ver nota arriba).
    const hasLeading = !!leading && leading.start <= 0.05;
    // Simétrico: solo cuenta si el silencio llega de verdad hasta el final del archivo (es el cierre
    // detectado por detectSilences cuando hay un silence_start sin su silence_end) — si termina antes,
    // es una pausa de en medio y tampoco se toca.
    const hasTrailing = !!trailing && trailing.end >= duration - 0.05 && trailing !== leading;

    if (!hasLeading && !hasTrailing) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const cutStart = hasLeading ? Math.min(duration, Math.max(0, leading.end - EDGE_PAD_SECONDS)) : 0;
    const cutEnd = hasTrailing ? Math.max(cutStart, Math.min(duration, trailing.start + EDGE_PAD_SECONDS)) : duration;
    const keptDuration = cutEnd - cutStart;
    if (keptDuration < 0.1) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const { name } = path.parse(videoPath);
    const outPath = path.join(VIDEO_EDITOR_TMP_DIR, `${name}-cut-${Date.now()}.mp4`);
    // `-ss` + `-t` (duración, no timestamp absoluto) para que el recorte de la punta final no dependa
    // de cómo ffmpeg interprete `-to` combinado con un `-ss` de salida. crf 16 + preset slow, igual que
    // enhance.ts: este corte es el PRIMER re-encode de la cadena (corte → enhance → render), así que
    // tiene que mantener el mismo estándar de calidad.
    const args = ["-y", "-i", videoPath];
    if (cutStart > 0) args.push("-ss", cutStart.toFixed(3));
    if (hasTrailing) args.push("-t", keptDuration.toFixed(3));
    args.push("-c:v", "libx264", "-crf", "16", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", outPath);
    await run("ffmpeg", args);

    const cutsApplied = (hasLeading ? 1 : 0) + (hasTrailing ? 1 : 0);
    const secondsRemoved = Number((cutStart + (duration - cutEnd)).toFixed(2));
    return { path: outPath, cutsApplied, secondsRemoved };
  } catch {
    return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };
  }
}
