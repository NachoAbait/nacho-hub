import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** Caption futura (fase 2, con Whisper): un tramo de texto animado con su ventana de frames. */
export type ReelCaption = {
  text: string;
  startFrame: number;
  endFrame: number;
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
  /** URL pública de la imagen del producto a mostrar en la caja flotante. null = sin overlay
   * (no se pudo matchear ningún producto por el nombre del archivo). */
  overlayImageUrl: string | null;
  /** Texto bajo la caja ("iPhone 17 Pro", "Cargador", ...). */
  overlayLabel: string | null;
  /** Cuántos segundos (desde el arranque del clip) se muestra la caja del producto. V1: no hay
   * forma de saber cuándo aparece el producto en pantalla de verdad, así que se usa un default
   * fijo (ver render.ts) en vez de sincronizarlo a ningún momento real del video. */
  overlayDurationInSeconds: number;
  /** TODO(whisper): fase 2 — subtítulos animados a partir de una transcripción real (OpenAI
   * Whisper, pendiente de que Nacho resuelva el billing). Hoy siempre [] — este campo es el punto
   * de extensión: cuando haya transcripción, se le pasan los tramos acá y listo, sin tocar el resto
   * de la composición. */
  captions?: ReelCaption[];
};

const GOLD = "#d4a640";
const GOLD_LIGHT = "#f5d98a";

/**
 * Estilo "spotlight de producto" copiado de la competencia que Nacho mostró: fondo con el
 * presentador difuminado y oscurecido, una caja redondeada con borde que brilla en dorado (la
 * competencia usa azul neón, acá se usa el dorado de la marca BNB — ver components/banners/category.tsx,
 * accent #d4a640) que entra con un "flip" en el primer segundo y se queda fija mostrando el
 * producto. Sin transcripción todavía, así que sin texto de caption (ver ReelCaption arriba).
 */
export function ReelComposition({
  videoSrc,
  overlayImageUrl,
  overlayLabel,
  overlayDurationInSeconds,
  captions = [],
}: ReelCompositionProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const overlayUntilFrame = Math.min(durationInFrames, Math.round(overlayDurationInSeconds * fps));
  const showOverlay = Boolean(overlayImageUrl) && frame < overlayUntilFrame;

  // Flip-in en el primer ~0.9s: rotateY de "de canto" (90°) a "de frente" (0°), con el leve
  // overshoot que da spring() — es la pseudo-3D que reemplaza a un giro de 360° real (solo hay
  // una foto del producto, no fotos desde todos los ángulos).
  const flipProgress = spring({ frame, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: Math.round(fps * 0.9) });
  const rotateY = interpolate(flipProgress, [0, 1], [90, 0]);
  const scale = interpolate(flipProgress, [0, 1], [0.7, 1]);
  const boxOpacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  const activeCaption = captions.find((c) => frame >= c.startFrame && frame < c.endFrame);

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
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(2px) brightness(0.55) saturate(0.9)" }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 90% 70% at 50% 30%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.7) 100%)" }}
      />

      {showOverlay && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 170 }}>
          <div style={{ perspective: 1000, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: 300,
                height: 300,
                borderRadius: 28,
                background: "linear-gradient(160deg, #1a1308 0%, #000 70%)",
                border: `3px solid ${GOLD}`,
                boxShadow: `0 0 18px 6px ${GOLD}99, 0 0 46px 14px ${GOLD}55, inset 0 0 20px ${GOLD}33`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                transform: `rotateY(${rotateY}deg) scale(${scale})`,
                opacity: boxOpacity,
              }}
            >
              <Img src={overlayImageUrl!} style={{ width: "72%", height: "72%", objectFit: "contain" }} />
            </div>

            {/* Reflejo tenue debajo, como piso de vidrio — refuerza la sensación de objeto 3D flotando. */}
            <div
              style={{
                marginTop: 2,
                width: 300,
                height: 50,
                borderRadius: 28,
                background: `linear-gradient(180deg, ${GOLD}26 0%, transparent 100%)`,
                transform: `scaleY(-1) rotateY(${rotateY}deg) scale(${scale})`,
                opacity: boxOpacity * 0.35,
                filter: "blur(3px)",
              }}
            />

            {overlayLabel && (
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
                {overlayLabel}
              </div>
            )}
          </div>
        </AbsoluteFill>
      )}

      {/* TODO(whisper): fase 2 — render del caption activo (bold, blanco, animado) acá abajo.
          `activeCaption` ya está calculado arriba; hoy siempre es undefined porque `captions` llega
          vacío desde render.ts (sin transcripción no hay texto que mostrar). */}
      {activeCaption && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 220 }}>
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 900,
              fontSize: 44,
              color: "white",
              textAlign: "center",
              textShadow: "0 2px 14px rgba(0,0,0,0.9)",
              maxWidth: "85%",
            }}
          >
            {activeCaption.text}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

export { GOLD, GOLD_LIGHT };
