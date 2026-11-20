import { spawn } from "node:child_process";
import path from "node:path";
import { VIDEO_EDITOR_TMP_DIR } from "@/lib/video-editor/render";

/** Silencio real a partir del cual se corta (pedido explícito: "si hay un segundo de silencio, que lo
 * corte" — pero no todo silencio: las pausas cortas y naturales de alguien hablando a cámara se dejan
 * como están, cortarlas todas haría el video ilegible). */
const MIN_SILENCE_SECONDS = 1.0;
/** Nivel por debajo del cual ffmpeg considera "silencio" — no es 0 absoluto, ruido de ambiente/mic
 * real nunca llega a -∞dB. */
const SILENCE_NOISE_DB = "-30dB";
/** Margen que se deja pegado a cada lado del corte para no comerse el ataque/cola de una palabra que
 * arranca o termina justo en el borde del silencio detectado. */
const PAD_SECONDS = 0.12;

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
    "-of", "default=noprint_wrapper=1:nokey=1",
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
 * Primer paso del pipeline, antes de cualquier otra edición (pedido explícito de Nacho: "antes de
 * editar cualquier cosa... que corte los silencios"): detecta los tramos de silencio ≥1s y arma un
 * video nuevo con esos tramos recortados (dejando un margen chico de cada lado para no comerse
 * palabras), concatenando los pedazos que sí tienen habla. Como esto corre ANTES de transcribir con
 * Whisper, todo lo que viene después (subtítulos, ventanas de producto) ya trabaja sobre la línea de
 * tiempo del video recortado — no hace falta reproyectar ningún timestamp.
 *
 * Nunca tira: si ffmpeg/ffprobe fallan, o no hay silencios de al menos 1s, devuelve el path original
 * sin tocar — el caller sigue con el clip completo en vez de perder el render.
 */
export async function cutSilences(videoPath: string): Promise<SilenceCutResult> {
  try {
    const duration = await probeDuration(videoPath);
    if (duration <= 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const silences = await detectSilences(videoPath);
    if (silences.length === 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const keep: SilenceWindow[] = [];
    let cursor = 0;
    for (const s of silences) {
      const segEnd = Math.min(duration, s.start + PAD_SECONDS);
      if (segEnd - cursor > 0.2) keep.push({ start: cursor, end: segEnd });
      cursor = Math.max(cursor, s.end - PAD_SECONDS);
    }
    if (duration - cursor > 0.2) keep.push({ start: cursor, end: duration });
    if (keep.length === 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const totalKept = keep.reduce((acc, w) => acc + (w.end - w.start), 0);
    const secondsRemoved = duration - totalKept;
    if (secondsRemoved < 0.3) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const filterParts: string[] = [];
    const pairLabels: string[] = [];
    keep.forEach((w, i) => {
      filterParts.push(`[0:v]trim=start=${w.start.toFixed(3)}:end=${w.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
      filterParts.push(`[0:a]atrim=start=${w.start.toFixed(3)}:end=${w.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      pairLabels.push(`[v${i}][a${i}]`);
    });
    const filterComplex = `${filterParts.join(";")};${pairLabels.join("")}concat=n=${keep.length}:v=1:a=1[outv][outa]`;

    const { name } = path.parse(videoPath);
    const outPath = path.join(VIDEO_EDITOR_TMP_DIR, `${name}-cut-${Date.now()}.mp4`);
    // crf 16 + preset slow, igual que enhance.ts: este corte es ahora el PRIMER re-encode de la
    // cadena (corte → enhance → render), así que tiene que mantener el mismo estándar de calidad.
    await run("ffmpeg", [
      "-y", "-i", videoPath,
      "-filter_complex", filterComplex,
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-crf", "16", "-preset", "slow",
      "-c:a", "aac", "-b:a", "192k",
      outPath,
    ]);

    return { path: outPath, cutsApplied: keep.length - 1, secondsRemoved: Number(secondsRemoved.toFixed(2)) };
  } catch {
    return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };
  }
}
