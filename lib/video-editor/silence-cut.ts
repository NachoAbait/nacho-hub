import { spawn } from "node:child_process";
import path from "node:path";
import { VIDEO_EDITOR_TMP_DIR } from "@/lib/video-editor/render";

/** Umbral de referencia para `detectSilences` cuando se usa como CHEQUEO (ver qc.ts). */
const MIN_SILENCE_SECONDS = 1.0;
/** El silencio en las PUNTAS del clip (antes de la primera palabra, después de la última) es tiempo
 * muerto quieto a cámara, no una pausa natural entre ideas — se evalúa con un umbral muy bajo para
 * cortarlo casi entero. Pedido explícito (27-11-2026): "cortá milisegundos antes de comenzar a
 * hablar, que casi no haya silencios". También sirve como umbral de detección general para
 * `cutSilences` (ver abajo): un solo `detectSilences` a este nivel encuentra TODO, puntas y pausas de
 * en medio por igual — la diferencia está en qué se hace con cada una. */
const EDGE_SILENCE_MIN_SECONDS = 0.03;
/** Una pausa de en medio del clip más corta que esto es respiración/prosodia normal al hablar — no
 * se toca aunque `detectSilences` la encuentre (el umbral de arriba es muy sensible a propósito).
 * Pedido (28-11-2026) de compactar pausas largas, no de eliminar cualquier micro-silencio entre
 * palabras. */
const MID_SILENCE_MIN_SECONDS = 0.3;
/** Nivel por debajo del cual ffmpeg considera "silencio" — no es 0 absoluto, ruido de ambiente/mic
 * real nunca llega a -∞dB. */
const SILENCE_NOISE_DB = "-30dB";
/** Margen que se deja pegado a cada punta (al final del silencio inicial, y al principio del
 * silencio final) para no comerse el ataque de la primera palabra ni el final de la última. Chico
 * porque de ese lado no hay habla real que proteger, solo el borde del propio corte — pedido explícito
 * (27-11-2026): "milisegundos antes de comenzar a hablar"; (28-11-2026): "ni bien termino de hablar...
 * pero justito justito". Mismo valor para las dos puntas, no hay motivo para que sean distintas. */
const EDGE_PAD_SECONDS = 0.04;
/** Margen que queda a cada lado de una pausa de EN MEDIO del clip después de compactarla. Historial
 * (28-11-2026): arrancó en 0.12 (~0.24s de hueco total) para no sentirse como jump-cut seco, después
 * de que el corte de solo las puntas (1.24s) se sintiera insuficiente ("tenes que cortarlo mucho
 * mas... por lo menos 3 mas"). Nacho después dio las frases finales de cada toma de un clip real y
 * pidió un corte mucho más ceñido SOLO en esos puntos (~0.025, "bien pegaditas") — probado en ese
 * render y confirmado como el estándar que quiere de ahora en adelante para TODO corte de en medio,
 * no solo esos puntos puntuales: "los cortes estuvieron espectacular... así los quiero de ahora en
 * adelante". Por eso este valor general bajó de 0.12 a 0.025, en vez de quedar como un caso especial
 * separado para cuando Nacho da las frases a mano. */
const MID_PAD_SECONDS = 0.025;

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
 * clip (antes de la primera palabra, después de la última — casi entero) Y COMPACTA las pausas largas
 * de EN MEDIO del clip (las deja en ~0.05s, bien pegadas, en vez de eliminarlas del todo). Historial de
 * pedidos sobre esto, en orden:
 * - (27-11-2026) "corta los clips milisegundos antes de comenzar a hablar... entre clip y clip, no me
 *   cortes adentro de un mismo clip" → solo puntas, nada de en medio.
 * - (28-11-2026) "ni bien termino de hablar en uno... pero justito justito" → se suma la punta final.
 * - (28-11-2026, sobre el resultado de lo anterior) "TENES QUE CORTARLO MUCHO MAS... por lo menos
 *   3 mas" → esto es lo que agrega la compactación de pausas de en medio (arrancó con pad 0.12,
 *   ~0.24s de hueco), y REVIERTE el "no me cortes adentro" del 27-11: ya no alcanzaba con las puntas
 *   (en un clip real, 1.24s) para lo que se pide ahora.
 * - (28-11-2026, sobre un corte manual mucho más ceñido en los puntos reales de cambio de toma de un
 *   clip real) "los cortes estuvieron espectacular... así los quiero de ahora en adelante" → confirma
 *   el pad ceñido (0.025, ~0.05s de hueco) como el estándar para TODAS las pausas de en medio, no un
 *   caso especial — bajó `MID_PAD_SECONDS` de 0.12 a 0.025.
 *
 * `detectSilences` (abajo) sigue existiendo tal cual para el chequeo de QC (ver qc.ts) — ese es
 * informativo y no corta nada.
 *
 * Como esto corre ANTES de transcribir con Whisper, todo lo que viene después (subtítulos, ventanas de
 * producto) ya trabaja sobre la línea de tiempo del video YA recortado/compactado — no hace falta
 * reproyectar ningún timestamp.
 *
 * Nunca tira: si ffmpeg/ffprobe fallan, o no hay nada que cortar/compactar, devuelve el path original
 * sin tocar — el caller sigue con el clip completo en vez de perder el render.
 */
export async function cutSilences(videoPath: string): Promise<SilenceCutResult> {
  try {
    const duration = await probeDuration(videoPath);
    if (duration <= 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    // Un solo detectSilences, al umbral más sensible — encuentra tanto las puntas como cualquier pausa
    // de en medio (hasta las chicas, de prosodia normal); cuáles de esas se tocan y cómo se decide más
    // abajo, no acá.
    const silences = await detectSilences(videoPath, EDGE_SILENCE_MIN_SECONDS);
    if (silences.length === 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const first = silences[0];
    const last = silences[silences.length - 1];
    // Solo cuenta si arranca de verdad en 0 (silence_start puede no ser exactamente 0 por redondeo de
    // ffmpeg) — si no, es una pausa más adelante en el clip, y se evalúa como pausa de en medio, no
    // como punta.
    const leading = first.start <= 0.05 ? first : null;
    // Simétrico: solo cuenta si el silencio llega de verdad hasta el final del archivo (es el cierre
    // que `detectSilences` arma cuando hay un silence_start sin su silence_end propio).
    const trailing = last !== leading && last.end >= duration - 0.05 ? last : null;
    // Pausas de en medio: todo lo demás, siempre que sean lo bastante largas como para no ser
    // respiración/prosodia normal (ver MID_SILENCE_MIN_SECONDS).
    const midWindows = silences
      .filter((w) => w !== leading && w !== trailing && w.end - w.start >= MID_SILENCE_MIN_SECONDS)
      .sort((a, b) => a.start - b.start);

    if (!leading && !trailing && midWindows.length === 0) {
      return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };
    }

    const clipStart = leading ? Math.min(duration, Math.max(0, leading.end - EDGE_PAD_SECONDS)) : 0;
    const clipEnd = trailing ? Math.max(clipStart, Math.min(duration, trailing.start + EDGE_PAD_SECONDS)) : duration;

    // Tramos a MANTENER: todo el clip (ya sin las puntas), menos el centro de cada pausa larga de en
    // medio — se deja MID_PAD_SECONDS de aire real a cada lado de la pausa, no silencio absoluto.
    const keepRanges: { start: number; end: number }[] = [];
    let cursor = clipStart;
    for (const w of midWindows) {
      const removeStart = Math.max(cursor, w.start + MID_PAD_SECONDS);
      const removeEnd = Math.min(clipEnd, w.end - MID_PAD_SECONDS);
      if (removeEnd <= removeStart) continue; // la pausa es más corta que 2×MID_PAD_SECONDS, no hay nada que sacarle
      keepRanges.push({ start: cursor, end: removeStart });
      cursor = removeEnd;
    }
    keepRanges.push({ start: cursor, end: clipEnd });
    const cleanRanges = keepRanges.filter((r) => r.end - r.start > 0.05);
    if (cleanRanges.length === 0) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const keptDuration = cleanRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
    const secondsRemoved = Number((duration - keptDuration).toFixed(2));
    if (secondsRemoved < 0.1) return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };

    const { name } = path.parse(videoPath);
    const outPath = path.join(VIDEO_EDITOR_TMP_DIR, `${name}-cut-${Date.now()}.mp4`);
    // crf 16 + preset slow, igual que enhance.ts: este corte es el PRIMER re-encode de la cadena
    // (corte → enhance → render), así que tiene que mantener el mismo estándar de calidad.
    if (cleanRanges.length === 1) {
      // Nada que compactar de en medio, solo puntas (o nada) — trim simple con -ss/-t, sin pasar por
      // filter_complex/concat de más.
      const { start, end } = cleanRanges[0];
      const args = ["-y", "-i", videoPath];
      if (start > 0) args.push("-ss", start.toFixed(3));
      if (end < duration) args.push("-t", (end - start).toFixed(3));
      args.push("-c:v", "libx264", "-crf", "16", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", outPath);
      await run("ffmpeg", args);
    } else {
      // Varios tramos: cada uno se recorta por separado (trim/atrim) y se concatenan con el filtro
      // concat — un -ss/-t no alcanza cuando hay que sacar pedazos de en medio, no solo de las puntas.
      const filterParts: string[] = [];
      const labels: string[] = [];
      cleanRanges.forEach((r, i) => {
        filterParts.push(
          `[0:v]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
          `[0:a]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
        );
        labels.push(`[v${i}][a${i}]`);
      });
      filterParts.push(`${labels.join("")}concat=n=${cleanRanges.length}:v=1:a=1[outv][outa]`);
      await run("ffmpeg", [
        "-y", "-i", videoPath,
        "-filter_complex", filterParts.join(";"),
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-crf", "16", "-preset", "slow",
        "-c:a", "aac", "-b:a", "192k",
        outPath,
      ]);
    }

    const cutsApplied = (leading ? 1 : 0) + (trailing ? 1 : 0) + (cleanRanges.length - 1);
    return { path: outPath, cutsApplied, secondsRemoved };
  } catch {
    return { path: videoPath, cutsApplied: 0, secondsRemoved: 0 };
  }
}
