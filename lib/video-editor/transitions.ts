import { spawn } from "node:child_process";

/**
 * Umbral del filtro `select='gt(scene,X)'` de ffmpeg: qué tan distinto tiene que ser un frame del
 * anterior para contar como corte duro (toma distinta, no un movimiento de cámara/gesto dentro de la
 * misma toma). Probado contra un clip real de Nacho (25-11-2026): 0.1 encontró los 6 cortes reales
 * entre tomas sin falsos positivos por gestos; 0.25 (el default típico de ejemplos de ffmpeg) no
 * encontró ninguno — las tomas de Nacho no cambian tanto de luz/encuadre entre sí como un corte de
 * cámara de verdad.
 */
const SCENE_THRESHOLD = 0.1;
/** Nacho graba sus tomas seguidas, nunca hay dos cortes genuinos a menos de esto — filtra ruido
 * (parpadeos del detector) sin arriesgarse a perderse un corte real. */
const MIN_GAP_SECONDS = 1.0;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 || code === null ? resolve(stderr) : reject(new Error(`ffmpeg salió con código ${code}: ${stderr.slice(-500)}`))));
  });
}

/**
 * Detecta los cortes duros entre tomas DENTRO de un mismo archivo — pedido explícito: Nacho ahora
 * exporta sus propias tomas ya unidas en un solo video antes de subirlo, y los cortes entre ellas
 * son "bastante evidentes" sin una transición. Corre sobre el clip YA cortado de silencios y
 * mejorado (el mismo que se va a renderizar), para que los segundos devueltos coincidan con la
 * línea de tiempo final — nunca sobre el crudo, que todavía no tiene los timestamps definitivos.
 *
 * Nunca tira: si ffmpeg falla, devuelve [] (el render sigue sin transiciones en vez de perderse).
 */
export async function detectHardCuts(videoPath: string): Promise<number[]> {
  try {
    const stderr = await run("ffmpeg", [
      "-i", videoPath,
      "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      "-f", "null", "-",
    ]);
    const times = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1])).filter((t) => Number.isFinite(t));
    times.sort((a, b) => a - b);
    const cuts: number[] = [];
    for (const t of times) {
      if (cuts.length === 0 || t - cuts[cuts.length - 1] >= MIN_GAP_SECONDS) cuts.push(t);
    }
    return cuts;
  } catch {
    return [];
  }
}
