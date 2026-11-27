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
/** Margen que se deja pegado al final del silencio inicial para no comerse el ataque de la primera
 * palabra. Chico (no los 0.12s que haría falta si hubiera habla de los DOS lados) porque acá no hay
 * nada del lado izquierdo que proteger — pedido explícito (27-11-2026): "milisegundos antes de
 * comenzar a hablar". */
const LEADING_PAD_SECONDS = 0.04;

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
 * Primer paso del pipeline, antes de cualquier otra edición. Recorta ÚNICAMENTE el silencio antes de
 * la primera palabra (tiempo muerto quieto a cámara antes de arrancar a hablar) — pedido explícito
 * (27-11-2026): "corta los clips milisegundos antes de comenzar a hablar... entre clip y clip, no me
 * cortes adentro de un mismo clip". Antes (hasta el mismo día) esta función también cortaba pausas
 * ≥1s en medio de una misma toma (MIN_SILENCE_SECONDS) — se sacó esa parte a pedido explícito: ya no
 * se toca nada que esté "adentro" del clip, solo el borde de arranque. `detectSilences` (abajo) sigue
 * existiendo tal cual para quien quiera ese chequeo más general (ver qc.ts), que es informativo y no
 * corta nada.
 *
 * Como esto corre ANTES de transcribir con Whisper, todo lo que viene después (subtítulos, ventanas de
 * producto) ya trabaja sobre la línea de tiempo del video recortado — no hace falta reproyectar
 * ningún timestamp.
 *
 * Nunca tira: si ffmpeg/ffprobe fallan, o no hay silencio inicial que cortar, devuelve el path
 * original sin tocar — el caller sigue con el clip completo en vez de perder el render.
 */
export async function cutSilences(videoPath: string): Promise<SilenceCutResult> {
  try {
    const duration = await probeDuration(videoPath);
    if (duration <= 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const leading = (await detectSilences(videoPath, LEADING_SILENCE_MIN_SECONDS))[0];
    // Solo cuenta si arranca de verdad en 0 (silence_start puede no ser exactamente 0 por redondeo de
    // ffmpeg) — si no, es una pausa más adelante en el clip, y esa ya no se toca (ver nota arriba).
    if (!leading || leading.start > 0.05) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const cutEnd = Math.min(duration, Math.max(0, leading.end - LEADING_PAD_SECONDS));
    if (cutEnd < 0.1) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const { name } = path.parse(videoPath);
    const outPath = path.join(VIDEO_EDITOR_TMP_DIR, `${name}-cut-${Date.now()}.mp4`);
    // Un solo trim desde cutEnd hasta el final — ya no hace falta concat (un único corte, siempre al
    // principio). crf 16 + preset slow, igual que enhance.ts: este corte es el PRIMER re-encode de la
    // cadena (corte → enhance → render), así que tiene que mantener el mismo estándar de calidad.
    await run("ffmpeg", [
      "-y", "-i", videoPath,
      "-ss", cutEnd.toFixed(3),
      "-c:v", "libx264", "-crf", "16", "-preset", "slow",
      "-c:a", "aac", "-b:a", "192k",
      outPath,
    ]);

    return { path: outPath, cutsApplied: 1, secondsRemoved: Number(cutEnd.toFixed(2)) };
  } catch {
    return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };
  }
}
