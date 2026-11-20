import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { getVideoMetadata, renderMedia, selectComposition } from "@remotion/renderer";
import { REEL_COMPOSITION_ID, REEL_FPS } from "@/remotion/Root";
import type { ReelCompositionProps, ReelPhrase } from "@/remotion/ReelComposition";

const ENTRY_POINT = path.join(process.cwd(), "remotion", "index.ts");

/**
 * `<OffthreadVideo>` (como `<Video>`) lo carga un Chromium real que sirve el bundle desde un HTTP
 * server local — el path del clip crudo tiene que poder pedirse por esa URL, una ruta absoluta del
 * filesystem no sirve tal cual (404). La solución de Remotion es `publicDir` + `staticFile()`.
 *
 * Por qué una carpeta DEDICADA y no os.tmpdir() entero: con `symlinkPublicDir: false` (el default)
 * bundle() COPIA todo lo que haya en publicDir al armar el bundle — apuntarlo al tmpdir entero del
 * sistema tira EPERM en macOS (carpetas como TemporaryItems) y de paso no vería clips descargados
 * DESPUÉS de bundlear. Con `symlinkPublicDir: true` en cambio bundle() symlinkea esta carpeta (en
 * vez de copiarla), así que sigue sirviendo en vivo lo que se le agregue más tarde — necesario
 * porque el bundle se cachea una sola vez por proceso (ver getServeUrl) pero cada clip nuevo llega
 * después. downloadClipToTmp (drive.ts) descarga ACÁ, no a os.tmpdir() a secas.
 */
export const VIDEO_EDITOR_TMP_DIR = path.join(os.tmpdir(), "nacho-hub-video-editor");
fsSync.mkdirSync(VIDEO_EDITOR_TMP_DIR, { recursive: true });

/**
 * BLOQUEO CONOCIDO (ver informe de la tarea): Remotion necesita un Chromium completo (no el
 * headless-shell recortado de @sparticuz/chromium que ya usa Playwright para los banners de Nico) y
 * la documentación oficial de Remotion dice directamente que hoy "no es posible" renderizar en
 * Vercel Serverless Functions por el límite de 50MB del bundle de la función — Chromium solo ya lo
 * llena (https://www.remotion.dev/docs/miscellaneous/vercel-functions, confirmado también por el FAQ
 * "Can I render videos using Vercel Serverless functions?"). La alternativa que recomienda Remotion
 * es Remotion Lambda (o, más nuevo, Vercel Sandbox) — ninguna de las dos está montada todavía.
 *
 * Por eso el render real de abajo SOLO corre fuera de Vercel: hoy mismo (local, `npm run dev` o un
 * cron corrido a mano desde la compu de Nacho) o el día que exista una Lambda/Sandbox propia. Dentro
 * de Vercel, el agente (ver lib/agents/video-editor.ts) nunca llega a llamar a renderReel: detecta
 * esto antes y deja el clip en video_clips.status = 'error' con un mensaje legible, en vez de romper
 * el deploy o la ejecución intentando algo que la propia Remotion dice que no entra.
 */
export function canRenderHere(): boolean {
  return !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

export const VERCEL_BLOCKER_MESSAGE =
  "Clip descargado y producto detectado, pero el render no corre en este entorno: Remotion necesita un Chromium completo " +
  "que no entra en el límite de 50MB de una Vercel Serverless Function (remotion.dev/docs/miscellaneous/vercel-functions dice " +
  "directamente que hoy no es posible). Hace falta correrlo a mano fuera de Vercel, o migrar a Remotion Lambda / Vercel Sandbox.";

let bundledServeUrlPromise: Promise<string> | null = null;

function getServeUrl(): Promise<string> {
  if (!bundledServeUrlPromise) {
    bundledServeUrlPromise = bundle({ entryPoint: ENTRY_POINT, publicDir: VIDEO_EDITOR_TMP_DIR, symlinkPublicDir: true });
  }
  return bundledServeUrlPromise;
}

/** Ventana de producto en SEGUNDOS (no frames: quien arma esto —lib/agents/video-editor.ts— trabaja
 * con los timestamps de Whisper, que vienen en segundos; convertir a frames es trabajo de este
 * archivo, que es el único que sabe el FPS real de la composición). */
export interface OverlaySegmentInput {
  startSec: number;
  endSec: number;
  imageUrl: string;
  label: string;
}

/** Ídem para el tono positivo/negativo detectado en esa ventana. */
export interface MoodSegmentInput {
  startSec: number;
  endSec: number;
  mood: "positive" | "negative";
}

export interface RenderReelInput {
  /** Ruta local del clip crudo ya descargado (ver downloadClipToTmp). */
  videoPath: string;
  /** Fallback cuando no hay (o falló) la detección por voz: un solo producto para todo el clip,
   * matcheado por el nombre del archivo (ver product-match.ts). Se ignora si `overlaySegments` trae
   * algo. */
  overlayImageUrl: string | null;
  overlayLabel: string | null;
  /** Solo aplica al fallback de arriba — cuánto dura esa caja fija. V1 sin detección por voz: no hay
   * forma de saber cuándo aparece el producto en pantalla de verdad, así que se usa un default fijo. */
  overlayDurationInSeconds?: number;
  /** Ventanas de producto detectadas por lo que se dice en el audio (ver content-analysis.ts). Si
   * viene con algo, reemplaza por completo al fallback de arriba — es la fuente más precisa. */
  overlaySegments?: OverlaySegmentInput[];
  /** Ventanas de tono positivo/negativo detectadas en el audio. [] = toda la caja en dorado neutro. */
  moodSegments?: MoodSegmentInput[];
  /** Subtítulos ya armados (ver lib/video-editor/captions.ts, buildPhrases) — render.ts no llama a
   * Whisper, solo ensambla lo que ya le pasaron. */
  phrases?: ReelPhrase[];
}

const DEFAULT_OVERLAY_SECONDS = 6;

/** Bundlea (una vez por proceso) y renderiza la composición "Reel" a un Buffer de MP4. Tira si `canRenderHere()` es false. */
export async function renderReel(input: RenderReelInput): Promise<Buffer> {
  if (!canRenderHere()) throw new Error(VERCEL_BLOCKER_MESSAGE);
  // downloadClipToTmp (drive.ts) siempre descarga adentro de VIDEO_EDITOR_TMP_DIR, que es justo el
  // publicDir que bundleamos más abajo — si algún día un caller pasa un video fuera de esa carpeta,
  // mejor fallar temprano con un mensaje claro que con un 404 silencioso de Remotion.
  if (path.resolve(path.dirname(input.videoPath)) !== path.resolve(VIDEO_EDITOR_TMP_DIR)) {
    throw new Error(`renderReel espera un video dentro de ${VIDEO_EDITOR_TMP_DIR} (ver publicDir); llegó ${input.videoPath}`);
  }

  const metadata = await getVideoMetadata(input.videoPath);
  // getVideoMetadata puede devolver null si no pudo leer la duración (contenedor raro, archivo
  // corrupto): mejor un default conservador que tirar y perder todo el render.
  const videoDurationInSeconds = metadata.durationInSeconds ?? 15;
  const durationInFrames = Math.max(1, Math.round(videoDurationInSeconds * REEL_FPS));

  const toFrameWindow = (startSec: number, endSec: number) => ({
    startFrame: Math.max(0, Math.min(durationInFrames, Math.round(startSec * REEL_FPS))),
    endFrame: Math.max(0, Math.min(durationInFrames, Math.round(endSec * REEL_FPS))),
  });

  const overlaySegments = (
    input.overlaySegments?.length
      ? input.overlaySegments
      : input.overlayImageUrl
        ? [
            {
              startSec: 0,
              endSec: Math.min(input.overlayDurationInSeconds ?? DEFAULT_OVERLAY_SECONDS, videoDurationInSeconds),
              imageUrl: input.overlayImageUrl,
              label: input.overlayLabel ?? "",
            },
          ]
        : []
  ).map((s) => ({ ...toFrameWindow(s.startSec, s.endSec), imageUrl: s.imageUrl, label: s.label }));

  const moodSegments = (input.moodSegments ?? []).map((s) => ({ ...toFrameWindow(s.startSec, s.endSec), mood: s.mood }));

  const serveUrl = await getServeUrl();
  const inputProps: ReelCompositionProps = {
    // Nombre de archivo nomás (ej. "video-editor-abc123-clip.mp4"), NO el resultado de staticFile():
    // staticFile() lee `window.remotion_staticBase`, que solo existe adentro del browser que corre
    // la composición — llamarlo desde este lado (Node) devuelve el path sin el prefijo "/public" y
    // Remotion tira 404. El staticFile() real pasa dentro de ReelComposition.tsx.
    videoSrc: path.basename(input.videoPath),
    videoDurationInSeconds,
    overlaySegments,
    moodSegments,
    phrases: input.phrases ?? [],
  };
  const serializableProps = inputProps as unknown as Record<string, unknown>;

  const composition = await selectComposition({ serveUrl, id: REEL_COMPOSITION_ID, inputProps: serializableProps });

  const outputLocation = path.join(os.tmpdir(), `reel-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  // crf 16 (no el default ~23 de Remotion): este es el SEGUNDO de dos pasos de compresión (el
  // primero es enhanceClip) — sin esto se pierde calidad dos veces seguidas y el resultado final se
  // ve notoriamente peor que el clip original.
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 16, outputLocation, inputProps: serializableProps });

  const buffer = await fs.readFile(outputLocation);
  await fs.unlink(outputLocation).catch(() => {});
  return buffer;
}
