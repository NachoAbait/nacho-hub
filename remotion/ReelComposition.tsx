import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** Un tramo de subtítulo (1-2 palabras, estilo karaoke) con su ventana de frames, armado por
 * lib/video-editor/captions.ts a partir de la transcripción de Whisper. */
export type ReelCaption = {
  text: string;
  startFrame: number;
  endFrame: number;
  /** Tamaño relativo (0.9x–1.4x) según el volumen medio del audio en ese tramo — la aproximación de
   * "énfasis" pedida: las partes dichas más fuerte salen más grandes. 1 si no se pudo calcular. */
  size?: number;
};

/** Qué producto mostrar en la caja flotante durante esta ventana de frames — arma la lista
 * lib/agents/video-editor.ts a partir de lo que Claude detectó que se dice en cada oración de la
 * transcripción (ver lib/video-editor/content-analysis.ts), no de un solo match por nombre de
 * archivo: si el video menciona varios modelos, la caja cambia de uno a otro seguiendo el audio. */
export type OverlaySegment = {
  startFrame: number;
  endFrame: number;
  imageUrl: string;
  label: string;
};

/** Tono de lo que se dice en esta ventana — cambia el color de la caja (verde/rojo) en vez del
 * dorado neutro, siguiendo el sentimiento que detectó Claude en esa oración. */
export type MoodSegment = {
  startFrame: number;
  endFrame: number;
  mood: "positive" | "negative";
};

/** `type`, no `interface`: Remotion's <Composition> necesita que Props satisfaga
 * `Record<string, unknown>`, y un `interface` (declaración abierta) no lo satisface aunque
 * estructuralmente sea igual — gotcha conocido de TypeScript. */
export type ReelCompositionProps = {
  /** Nombre de archivo (no ruta completa) del video crudo dentro de VIDEO_EDITOR_TMP_DIR — ver
   * render.ts: ahí vive publicDir, y acá adentro se lo resuelve con staticFile() porque
   * `window.remotion_staticBase` solo existe en este contexto de browser, no del lado de Node. */
  videoSrc: string;
  /** Duración real del clip de fondo, en segundos — define cuánto dura la composición entera
   * (ver calculateMetadata en Root.tsx: sin esto, Remotion no sabe cuándo cortar). */
  videoDurationInSeconds: number;
  /** Ventanas de producto a mostrar (ver OverlaySegment arriba). [] = nunca aparece la caja (no se
   * detectó ningún modelo, ni por voz ni por nombre de archivo — ver render.ts para el fallback). */
  overlaySegments: OverlaySegment[];
  /** Ventanas de tono positivo/negativo (ver MoodSegment arriba). Fuera de esas ventanas, o si
   * viene vacío, la caja usa el dorado neutro de siempre. */
  moodSegments: MoodSegment[];
  /** Subtítulos animados a partir de la transcripción de Whisper (ver lib/video-editor/captions.ts).
   * [] si no hay `OPENAI_API_KEY` o si Whisper falló para este clip — el render sigue sin subtítulos
   * en vez de romperse. */
  captions?: ReelCaption[];
};

const GOLD = "#d4a640";
const GOLD_LIGHT = "#f5d98a";
const GREEN = "#36c766";
const GREEN_LIGHT = "#8ef0ab";
const RED = "#e5484d";
const RED_LIGHT = "#f5a3a6";

const MOOD_COLORS: Record<"neutral" | "positive" | "negative", { accent: string; light: string }> = {
  neutral: { accent: GOLD, light: GOLD_LIGHT },
  positive: { accent: GREEN, light: GREEN_LIGHT },
  negative: { accent: RED, light: RED_LIGHT },
};

/**
 * Estilo "spotlight de producto" copiado de la competencia que Nacho mostró: fondo con el
 * presentador difuminado y oscurecido, una caja redondeada con borde que brilla (dorado neutro,
 * verde si lo que se dice en ese momento es positivo, rojo si es negativo — ver MOOD_COLORS) que
 * entra con un "flip" cada vez que cambia de producto, con la propia foto del producto agrandada y
 * difuminada de fondo detrás de la versión nítida.
 */
export function ReelComposition({
  videoSrc,
  overlaySegments,
  moodSegments,
  captions = [],
}: ReelCompositionProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Zoom lento tipo "Ken Burns" sobre todo el clip de fondo — sin esto la cámara se siente estática
  // durante 15-30 segundos seguidos.
  const videoScale = interpolate(frame, [0, durationInFrames], [1, 1.08], { extrapolateRight: "clamp" });

  const activeOverlay = overlaySegments.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null;
  const activeMood = moodSegments.find((s) => frame >= s.startFrame && frame < s.endFrame)?.mood ?? "neutral";
  const { accent, light } = MOOD_COLORS[activeMood];

  // Flip-in relativo al arranque de ESTE segmento (no del video entero): cada vez que cambia de
  // producto, la caja vuelve a hacer el flip desde "de canto" — la "transición" entre productos que
  // pidió Nacho, en vez de un solo flip al principio del clip y quieto el resto del tiempo.
  const localFrame = activeOverlay ? frame - activeOverlay.startFrame : 0;
  const flipProgress = spring({ frame: localFrame, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: Math.round(fps * 0.9) });
  const rotateY = interpolate(flipProgress, [0, 1], [90, 0]);
  const scale = interpolate(flipProgress, [0, 1], [0.7, 1]);
  const boxOpacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  const activeCaption = captions.find((c) => frame >= c.startFrame && frame < c.endFrame);
  const captionPop = activeCaption
    ? spring({ frame: frame - activeCaption.startFrame, fps, config: { damping: 12, mass: 0.4 }, durationInFrames: 6 })
    : 0;
  const captionScale = (activeCaption?.size ?? 1) * interpolate(captionPop, [0, 1], [0.8, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* OffthreadVideo (no <Video>): el clip crudo lo descarga render.ts a una ruta local absoluta
          (os.tmpdir(), fuera de la carpeta public/ del bundle), y <Video> es el <video> nativo del
          browser — necesita que esa ruta se pueda pedir por HTTP al server local del bundle, cosa
          que nunca pasa con una ruta absoluta del filesystem (tira MEDIA_ELEMENT_ERROR). OffthreadVideo
          extrae los frames del lado del servidor (vía ffmpeg), así que sí acepta paths locales tal
          cual — es justo el caso de uso que documenta Remotion para esto. */}
      <OffthreadVideo
        src={staticFile(videoSrc)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(2px) brightness(0.55) saturate(0.9)",
          transform: `scale(${videoScale})`,
        }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 90% 70% at 50% 30%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.7) 100%)" }}
      />

      {activeOverlay && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 170 }}>
          <div style={{ perspective: 1000, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: 300,
                height: 300,
                borderRadius: 28,
                background: "linear-gradient(160deg, #1a1308 0%, #000 70%)",
                border: `3px solid ${accent}`,
                boxShadow: `0 0 18px 6px ${accent}99, 0 0 46px 14px ${accent}55, inset 0 0 20px ${accent}33`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                position: "relative",
                transform: `rotateY(${rotateY}deg) scale(${scale})`,
                opacity: boxOpacity,
              }}
            >
              {/* Fondo: la misma imagen del producto, agrandada y difuminada hasta llenar la caja
                  entera — el efecto "spotlight" de la competencia (foto de fondo + versión nítida
                  encima), en vez del degradé liso que había antes. */}
              <Img
                src={activeOverlay.imageUrl}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: "blur(18px) brightness(0.55) saturate(1.3)",
                  transform: "scale(1.3)",
                }}
              />
              <Img
                src={activeOverlay.imageUrl}
                style={{ position: "relative", width: "72%", height: "72%", objectFit: "contain" }}
              />
            </div>

            {/* Reflejo tenue debajo, como piso de vidrio — refuerza la sensación de objeto 3D flotando. */}
            <div
              style={{
                marginTop: 2,
                width: 300,
                height: 50,
                borderRadius: 28,
                background: `linear-gradient(180deg, ${accent}26 0%, transparent 100%)`,
                transform: `scaleY(-1) rotateY(${rotateY}deg) scale(${scale})`,
                opacity: boxOpacity * 0.35,
                filter: "blur(3px)",
              }}
            />

            {activeOverlay.label && (
              <div
                style={{
                  marginTop: 18,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontWeight: 900,
                  fontSize: 32,
                  color: "white",
                  textAlign: "center",
                  textShadow: "0 2px 12px rgba(0,0,0,0.85)",
                  opacity: boxOpacity,
                }}
              >
                {activeOverlay.label}
              </div>
            )}
          </div>
        </AbsoluteFill>
      )}

      {/* Subtítulo activo: 1-2 palabras grandes (estilo karaoke), con un "pop" de entrada y un
          tamaño que varía según el volumen de esas palabras en el audio original (ver captionScale
          arriba y lib/video-editor/captions.ts) — el "énfasis dinámico" pedido. Toma el mismo color
          de ánimo que la caja para que todo el reel reaccione junto a lo que se está diciendo. */}
      {activeCaption && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 220 }}>
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 900,
              fontSize: 44,
              color: activeMood === "neutral" ? "white" : light,
              textAlign: "center",
              textShadow: "0 2px 14px rgba(0,0,0,0.9)",
              maxWidth: "85%",
              transform: `scale(${captionScale})`,
            }}
          >
            {activeCaption.text.toUpperCase()}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

export { GOLD, GOLD_LIGHT, GREEN, RED };
