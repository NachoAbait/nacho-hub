import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { VIDEO_EDITOR_TMP_DIR, type CutoutSceneInput, type OverlaySegmentInput } from "@/lib/video-editor/render";
import type { WhisperSegment, WhisperWord } from "@/lib/video-editor/captions";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "video-editor", "cutout_scene.py");
const MODEL_PATH = path.join(process.cwd(), "scripts", "video-editor", "assets", "selfie_segmenter.tflite");

/** Cada cuántas oraciones elegibles se elige UNA para el efecto "detrás tuyo" (pedido explícito,
 * 26-11-2026: "a veces", no todo el tiempo — ver el ejemplo de Instagram que mandó Nacho). Tope duro
 * aparte por video: cada escena corre MediaPipe cuadro por cuadro con un proceso Python separado, no
 * es gratis — no vale la pena multiplicar el tiempo de render de un reel de 20-30s. */
const EVERY_NTH_ELIGIBLE = 4;
const MAX_DEPTH_SCENES_PER_CLIP = 3;
/** Una oración muy corta no alcanza a leerse bien compitiendo con la cara detrás. */
const MIN_PHRASE_SECONDS = 1.2;

function runPython(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`cutout_scene.py salió con código ${code}: ${stderr.slice(-800)}`))));
  });
}

export interface DepthScenesResult {
  cutoutScenes: CutoutSceneInput[];
  warnings: string[];
}

/**
 * Elige ALGUNAS oraciones del video (ver EVERY_NTH_ELIGIBLE/MAX_DEPTH_SCENES_PER_CLIP) para el
 * efecto "subtítulo detrás tuyo" (pedido explícito de Nacho, 26-11-2026, con el ejemplo de Instagram
 * que mandó) y las compone con MediaPipe (scripts/video-editor/cutout_scene.py --mode depth) — a
 * diferencia de las escenas whitebg/moneyrain (manuales, pensadas para UNA frase puntual de UN
 * guión, con un fondo nuevo), esto corre AUTOMÁTICO para cualquier video que procese el agente, y el
 * fondo real del clip no cambia en nada: solo se le superpone la persona recortada sobre el mismo
 * texto, sobre el mismo fondo que ya se filmó.
 *
 * Nunca tira: si falta el modelo de MediaPipe, si python3/mediapipe no están instalados en esta
 * máquina, o si una escena puntual falla, esa oración se queda con el subtítulo normal (en pantalla,
 * no atrás) en vez de perder el render entero — mismo criterio "nunca tira" que el resto del
 * pipeline (ver lib/agents/video-editor.ts).
 */
export async function buildDepthScenes(
  videoPath: string,
  segments: WhisperSegment[],
  words: WhisperWord[],
  overlaySegments: OverlaySegmentInput[],
): Promise<DepthScenesResult> {
  try {
    await fs.access(MODEL_PATH);
  } catch {
    return { cutoutScenes: [], warnings: [] }; // sin modelo instalado en esta máquina, no hay nada para hacer acá
  }

  const eligible = segments
    .filter((seg) => seg.end - seg.start >= MIN_PHRASE_SECONDS)
    // Nunca durante una ventana donde ya está la caja de producto — esa ya tapa el subtítulo normal,
    // meter además una escena especial ahí se pisaría con el flip-in de la caja.
    .filter((seg) => !overlaySegments.some((o) => seg.start < o.endSec && seg.end > o.startSec));

  const chosen = eligible.filter((_, i) => i > 0 && i % EVERY_NTH_ELIGIBLE === 0).slice(0, MAX_DEPTH_SCENES_PER_CLIP);

  const cutoutScenes: CutoutSceneInput[] = [];
  const warnings: string[] = [];
  for (const seg of chosen) {
    const segWords = words.filter((w) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05);
    if (segWords.length === 0) continue;

    // Mismo formato que espera cutout_scene.py --captions: UN grupo por oración, tiempos relativos
    // al arranque de la escena (no al clip entero) — ver draw_caption en el script.
    const captions = [
      {
        start: 0,
        end: seg.end - seg.start,
        words: segWords.map((w) => ({ text: w.word.trim(), start: Math.max(0, w.start - seg.start) })),
      },
    ];

    const clipFileName = `depth-${Date.now()}-${Math.round(seg.start * 1000)}.mp4`;
    const outPath = path.join(VIDEO_EDITOR_TMP_DIR, clipFileName);
    try {
      await runPython([
        SCRIPT_PATH,
        "--video", videoPath,
        "--start", seg.start.toFixed(3),
        "--end", seg.end.toFixed(3),
        "--mode", "depth",
        "--out", outPath,
        "--model", MODEL_PATH,
        "--captions", JSON.stringify(captions),
      ]);
      cutoutScenes.push({ startSec: seg.start, endSec: seg.end, clipFileName });
    } catch (err) {
      warnings.push(
        `Escena "detrás tuyo" ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s falló, sigo con subtítulo normal ahí — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { cutoutScenes, warnings };
}
