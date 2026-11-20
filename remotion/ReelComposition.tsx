import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCaptionFont } from "@remotion/google-fonts/ArchivoBlack";

// Tipografía "pro" para subtítulos — ArchivoBlack (negrita ancha, sin serifa) en vez de la Arial del
// sistema. Se probó primero con Anton (condensada) pero Nacho mandó una captura de la competencia
// (@lmimport.dolores) con un look más parecido a este: ancho normal, bien grueso, blanco con
// contorno — no condensado. loadFont() se llama una sola vez al cargar el módulo; Remotion espera
// esta promesa sola antes de renderizar el primer frame.
const { fontFamily: CAPTION_FONT } = loadCaptionFont("normal", { weights: ["400"], subsets: ["latin"] });

/** Contorno negro sólido (no un blur) + una sombra suave debajo — el look "impact text" de los
 * subtítulos de la competencia, legible sobre cualquier fondo sin necesitar una placa detrás. */
const CAPTION_OUTLINE =
  "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, " +
  "-3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000, 0 6px 10px rgba(0,0,0,0.55)";

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

  // Dos efectos combinados sobre el fondo: un "zoom de entrada" rápido en el primer medio segundo
  // (entra grande y se asienta, como pidió Nacho) + el drift lento tipo "Ken Burns" durante todo el
  // resto del clip, para que nunca se sienta una cámara fija.
  const entranceProgress = spring({ frame, fps, config: { damping: 20, mass: 0.7 }, durationInFrames: Math.round(fps * 0.6) });
  const entranceScale = interpolate(entranceProgress, [0, 1], [1.32, 1]);
  const driftScale = interpolate(frame, [0, durationInFrames], [1, 1.16], { extrapolateRight: "clamp" });
  const videoScale = entranceScale * driftScale;

  const activeOverlay = overlaySegments.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null;
  const activeMood = moodSegments.find((s) => frame >= s.startFrame && frame < s.endFrame)?.mood ?? "neutral";
  const { accent, light } = MOOD_COLORS[activeMood];

  // Flip-in relativo al arranque de ESTE segmento (no del video entero): cada vez que cambia de
  // producto, la caja vuelve a hacer el flip desde "de canto" — la "transición" entre productos que
  // pidió Nacho. Antes tardaba 0.9s en asentarse: con ventanas cortas (un modelo nombrado y
  // enseguida el siguiente) la caja nunca llegaba a verse quieta antes de cambiar — se SENTÍA
  // desincronizada aunque el ancla (anchorOverlaySegments) fuera exacta. 0.35s con menos masa: entra
  // rápido y se asienta, deja tiempo real mostrando el producto incluso en ventanas de ~1 segundo.
  const localFrame = activeOverlay ? frame - activeOverlay.startFrame : 0;
  const flipProgress = spring({ frame: localFrame, fps, config: { damping: 16, mass: 0.35 }, durationInFrames: Math.round(fps * 0.35) });
  const rotateY = interpolate(flipProgress, [0, 1], [90, 0]);
  const scale = interpolate(flipProgress, [0, 1], [0.7, 1]);
  const boxOpacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  // Nunca al mismo tiempo que la caja de producto: mostrar las dos cosas juntas "sería mucha cosa"
  // (feedback directo de Nacho) — el subtítulo solo aparece en los tramos donde se está presentando
  // a cámara, no mientras se ve el render del celular.
  const activeCaption = activeOverlay ? undefined : captions.find((c) => frame >= c.startFrame && frame < c.endFrame);
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
          // Menos oscuro que antes (brightness 0.55 → 0.78, el degradé de abajo 0.7 → 0.4 de opacidad
          // máxima): se había puesto demasiado opaco, apenas se distinguía al presentador.
          filter: "blur(2px) brightness(0.78) saturate(0.95)",
          transform: `scale(${videoScale})`,
        }}
      />
      {/* Viñeta: oscurece los bordes (no el centro, donde está la cara) — dar sensación de foco sin
          tocar la nitidez real del video (eso lo arruinaría; la calidad del archivo se cuida en
          enhance.ts/render.ts con crf 16, no acá). */}
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 85% 65% at 50% 32%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.5) 100%)" }}
      />

      {/* Caja de producto: antes arriba y chica (300px), ahora grande (440px) y centrada en la
          mitad inferior — deja a los subtítulos su propio espacio pegado al borde de abajo, sin
          pisarse. */}
      {activeOverlay && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 340 }}>
          <div style={{ perspective: 1000, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: 440,
                height: 440,
                borderRadius: 36,
                background: "linear-gradient(160deg, #1a1308 0%, #000 70%)",
                border: `4px solid ${accent}`,
                boxShadow: `0 0 22px 8px ${accent}99, 0 0 56px 18px ${accent}55, inset 0 0 26px ${accent}33`,
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
                marginTop: 3,
                width: 440,
                height: 70,
                borderRadius: 36,
                background: `linear-gradient(180deg, ${accent}26 0%, transparent 100%)`,
                transform: `scaleY(-1) rotateY(${rotateY}deg) scale(${scale})`,
                opacity: boxOpacity * 0.35,
                filter: "blur(3px)",
              }}
            />

            {activeOverlay.label && (
              <div
                style={{
                  marginTop: 22,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontWeight: 900,
                  fontSize: 40,
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

      {/* Subtítulo activo: una palabra por vez (estilo karaoke real, no de a 2 — de a 2 cortaba
          frases en pedazos sin sentido, ej. "16 EL"). Sin placa de fondo, blanco con contorno negro
          sólido (ver CAPTION_OUTLINE) — el look de la referencia que mandó Nacho, no la placa oscura
          semitransparente de antes. Reposicionado a la mitad del cuadro (ni pegado arriba de la
          cabeza ni abajo del todo) y nunca al mismo tiempo que la caja de producto (ver
          activeCaption arriba). Un "pop" de entrada y un tamaño que varía según el volumen de esa
          palabra en el audio original (ver captionScale arriba y lib/video-editor/captions.ts) — el
          "énfasis dinámico" pedido. */}
      {activeCaption && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 900 }}>
          <div
            style={{
              fontFamily: CAPTION_FONT,
              letterSpacing: "0.01em",
              fontSize: 68,
              color: activeMood === "neutral" ? "white" : light,
              textAlign: "center",
              textShadow: CAPTION_OUTLINE,
              maxWidth: "85%",
              transform: `scale(${captionScale})`,
            }}
          >
            {activeCaption.text.toUpperCase()}
          </div>
        </AbsoluteFill>
      )}

      {/* Un "pop" sonoro por cada palabra (pedido explícito: "que haga un mínimo efecto de sonido
          al aparecer cada palabra") — se dispara UNA vez por palabra, en el frame exacto en que
          arranca, por eso va envuelta en su propio <Sequence> (no atada a `activeCaption`, que solo
          existe cuando no hay caja de producto: el sonido tiene que sonar siempre que la palabra se
          diga, muestre caption o no en pantalla en ese instante). */}
      {captions.map((c, i) => (
        <Sequence key={i} from={c.startFrame} durationInFrames={Math.max(1, c.endFrame - c.startFrame)} layout="none">
          <Audio src={staticFile("caption-pop.mp3")} volume={1.4} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

export { GOLD, GOLD_LIGHT, GREEN, RED };
