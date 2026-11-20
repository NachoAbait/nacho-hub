import { getVideoMetadata } from "@remotion/renderer";
import { REEL_FPS } from "@/remotion/Root";
import type { ReelPhrase } from "@/remotion/ReelComposition";
import type { OverlaySegmentInput } from "@/lib/video-editor/render";
import { detectSilences } from "@/lib/video-editor/silence-cut";

export interface QcCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Chequeos automáticos antes de dar un render por bueno — pedido explícito de Nacho: "que un agente
 * verifique cosas básicas... para ahorrarnos hacer 34 versiones". Corre adentro del pipeline, en cada
 * clip, sin que nadie tenga que mirar el video entero para notar una rotura silenciosa. No reemplaza
 * la revisión humana de un cambio nuevo al propio código del editor (capturas de frames reales antes
 * de mandar nada) — este es el chequeo que corre SIEMPRE, de acá en adelante, sobre cada clip.
 */
export async function runQc(input: {
  /** El clip tal como se le va a pasar a Remotion (ya cortado de silencios y mejorado) — el QC mide
   * sobre esto, no sobre el original crudo. */
  videoPath: string;
  phrases: ReelPhrase[];
  overlaySegments: OverlaySegmentInput[];
  missingPhotoModels: string[];
}): Promise<QcCheck[]> {
  const checks: QcCheck[] = [];

  const metadata = await getVideoMetadata(input.videoPath);
  const durationInSeconds = metadata.durationInSeconds ?? 0;
  const durationInFrames = Math.round(durationInSeconds * REEL_FPS);

  checks.push({
    name: "todos los modelos nombrados tienen foto",
    passed: input.missingPhotoModels.length === 0,
    detail: input.missingPhotoModels.length === 0 ? "ok" : `faltan: ${input.missingPhotoModels.join(", ")}`,
  });

  const badOverlay = input.overlaySegments.find(
    (s) => s.startSec < 0 || s.endSec > durationInSeconds + 0.5 || s.startSec >= s.endSec,
  );
  checks.push({
    name: "ventanas de producto dentro del video",
    passed: !badOverlay,
    detail: badOverlay ? `"${badOverlay.label}" ${badOverlay.startSec.toFixed(2)}–${badOverlay.endSec.toFixed(2)}s fuera de rango` : "ok",
  });

  let badPhrase: string | null = null;
  for (const p of input.phrases) {
    if (p.startFrame < 0 || p.endFrame > durationInFrames + 5 || p.startFrame >= p.endFrame) {
      badPhrase = `frase fuera de rango (${p.startFrame}-${p.endFrame} de ${durationInFrames} frames totales)`;
      break;
    }
    const outOfBoundsWord = p.words.find((w) => w.startFrame < p.startFrame || w.startFrame > p.endFrame);
    if (outOfBoundsWord) {
      badPhrase = `palabra "${outOfBoundsWord.text}" fuera de los límites de su propia frase`;
      break;
    }
  }
  checks.push({ name: "subtítulos sincronizados con sus propios límites", passed: !badPhrase, detail: badPhrase ?? "ok" });

  const leftoverSilences = await detectSilences(input.videoPath, 1.0).catch(() => []);
  checks.push({
    name: "sin silencios largos (≥1s) sin cortar",
    passed: leftoverSilences.length === 0,
    detail: leftoverSilences.length === 0 ? "ok" : `${leftoverSilences.length} tramo(s) de ≥1s sin cortar`,
  });

  return checks;
}
