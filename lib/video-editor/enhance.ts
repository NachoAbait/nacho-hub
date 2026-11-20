import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Auto-mejora de imagen tipo el "Enhance" de CapCut: sube levemente brillo/contraste/saturación y
 * agrega nitidez (unsharp mask) — CapCut en "4K" no mejora nada por sí solo, es solo la resolución
 * de exportación; esto sí hace algo real con lo que ya está filmado, antes de que Remotion lo tome
 * como fondo. Corre con ffmpeg (ya instalado, mismo binario que usa captions.ts) sobre una copia —
 * nunca pisa el original por si falla a mitad de camino.
 *
 * Nunca tira: si ffmpeg falla por lo que sea, el caller sigue con el clip original sin mejorar en
 * vez de perder el render entero.
 */
export async function enhanceClip(videoPath: string): Promise<string> {
  const { dir, name } = path.parse(videoPath);
  // SIEMPRE .mp4, sin importar la extensión del original: los clips que bajamos de Drive a veces
  // no tienen extensión en el nombre (Drive no siempre la pone) — sin una extensión reconocida ni
  // `-f` explícito, ffmpeg no puede adivinar el muxer de salida y tira "Invalid argument".
  const outPath = path.join(dir, `${name}-enhanced.mp4`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-vf", "eq=contrast=1.08:brightness=0.03:saturation=1.12,unsharp=5:5:0.6:5:5:0.0",
      // crf 16 + preset slow: casi sin pérdida. Por defecto ffmpeg usa crf 23 (visible), y este es
      // el PRIMERO de dos pasos de compresión (el segundo es el render final de Remotion) — si este
      // paso ya pierde calidad, el segundo la pierde de nuevo sobre lo ya degradado.
      "-c:v", "libx264", "-crf", "16", "-preset", "slow",
      "-c:a", "copy",
      "-f", "mp4",
      outPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (enhance) salió con código ${code}: ${stderr.slice(-500)}`))));
  });

  return outPath;
}
