import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCaptionFont } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadKeywordFont } from "@remotion/google-fonts/Anton";

// Dos tipografías, no una — pedido explícito: "que cambie tipografía en el medio de las oraciones,
// no que sea todo texto plano". ArchivoBlack (ancha) para palabras normales, Anton (condensada) para
// las que lib/video-editor/caption-style.ts marca como "keyword" o "critical" — el cambio de forma
// de la letra es parte del énfasis, no solo el tamaño o el color.
const { fontFamily: CAPTION_FONT } = loadCaptionFont("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: KEYWORD_FONT } = loadKeywordFont("normal", { weights: ["400"], subsets: ["latin"] });

/** Contorno negro sólido (no un blur) + una sombra suave debajo — el look "impact text" de los
 * subtítulos de la competencia, legible sobre cualquier fondo sin necesitar una placa detrás. */
const CAPTION_OUTLINE =
  "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, " +
  "-3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000, 0 6px 10px rgba(0,0,0,0.55)";

/** Una palabra dentro de una frase (ver ReelPhrase abajo), armada por lib/video-editor/captions.ts
 * a partir de la transcripción de Whisper. */
export type ReelWord = {
  text: string;
  /** Frame en el que esta palabra se agrega a la frase que se está completando — no desaparece
   * hasta que termine toda la frase (ver ReelPhrase), solo se SUMAN palabras nuevas. */
  startFrame: number;
  /** Tamaño relativo (0.9x–1.4x) según el volumen medio del audio en ese tramo — variación chica,
   * "orgánica" (se combina con `level`, que es el salto grande de énfasis). 1 si no se pudo calcular. */
  size?: number;
  /** Qué tan importante es ESTA palabra para lo que se está diciendo (clasificado por Claude en
   * lib/video-editor/caption-style.ts, análisis semántico — no volumen): "normal" (tipografía y
   * tamaño base) o "keyword"/"critical" (tipografía distinta + más grande — ver LEVEL_STYLE). Dos
   * niveles de tamaño, una sola tipografía de énfasis: alcanza con eso, sin sumarle variedad de
   * colores (pedido explícito de Nacho). "normal" si no se pudo clasificar. */
  level?: "normal" | "keyword" | "critical";
};

/** Una frase/oración completa, con sus palabras — en pantalla se van SUMANDO (ReelWord.startFrame)
 * a medida que se hablan, sin que las anteriores desaparezcan, hasta `endFrame`: ahí se limpia todo
 * de una y arranca la frase siguiente. Reemplaza al viejo esquema de una palabra a la vez
 * reemplazando a la anterior — pedido explícito: "que no aparezcan y desaparezcan, como que la
 * oración se va completando a medida que hablo". */
export type ReelPhrase = {
  startFrame: number;
  endFrame: number;
  words: ReelWord[];
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
  /** Subtítulos animados a partir de la transcripción de Whisper (ver lib/video-editor/captions.ts),
   * agrupados por frase (ver ReelPhrase). [] si no hay `OPENAI_API_KEY` o si Whisper falló para este
   * clip — el render sigue sin subtítulos en vez de romperse. */
  phrases?: ReelPhrase[];
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

/** Cómo se ve cada palabra según `ReelWord.level` (clasificación semántica de Claude, ver
 * lib/video-editor/caption-style.ts) — tamaño Y tipografía cambian juntos; sin variedad de colores
 * (Nacho pidió explícitamente bajarle a los colores: "tipografía y tamaño alcanza"). Todo el texto es
 * blanco (ver CAPTION_OUTLINE más abajo) — lo que marca el énfasis es la forma de la letra y cuánto
 * ocupa, no de qué color es. */
const LEVEL_STYLE: Record<"normal" | "keyword" | "critical", { scale: number; font: string }> = {
  normal: { scale: 1, font: CAPTION_FONT },
  keyword: { scale: 1.18, font: KEYWORD_FONT },
  critical: { scale: 1.4, font: KEYWORD_FONT },
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
  phrases = [],
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
  const { accent } = MOOD_COLORS[activeMood];

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
  const activePhrase = activeOverlay ? undefined : phrases.find((p) => frame >= p.startFrame && frame < p.endFrame);
  // La frase se va completando: todas las palabras cuyo `startFrame` ya pasó quedan en pantalla
  // juntas (no se reemplazan entre sí) hasta que termina la frase entera.
  const visibleWords = activePhrase?.words.filter((w) => frame >= w.startFrame) ?? [];

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

      {/* Subtítulo activo: la frase se va completando palabra por palabra (no una a la vez
          reemplazando a la anterior — pedido explícito: "que no aparezcan y desaparezcan, como que
          la oración se va completando a medida que hablo"). Sin placa de fondo, blanco con contorno
          negro sólido (ver CAPTION_OUTLINE), sin variedad de colores — el énfasis lo marcan la
          tipografía y el tamaño de cada palabra (ver LEVEL_STYLE), no el color. Reposicionado a la
          mitad del cuadro y nunca al mismo tiempo que la caja de producto (ver activePhrase arriba).
          Cada palabra nueva entra con su propio "pop" (ver WordSpan). */}
      {visibleWords.length > 0 && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 780 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 18px", maxWidth: "88%" }}>
            {visibleWords.map((w, i) => (
              <WordSpan key={i} word={w} frame={frame} fps={fps} />
            ))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** Una palabra dentro de la frase que se va completando — su propio spring de entrada (pop chico,
 * no gira ni nada: la frase entera no tiene que sentirse como un carrusel, solo que cada palabra se
 * sume con un empujón breve) separado en su propio componente porque cada una necesita su propio
 * `spring()` con un frame relativo distinto (`frame - word.startFrame`), y eso solo es válido dentro
 * de un componente propio, no de un callback suelto dentro de .map(). */
const CAPTION_BASE_SIZE = 54;

function WordSpan({ word, frame, fps }: { word: ReelWord; frame: number; fps: number }) {
  const pop = spring({ frame: frame - word.startFrame, fps, config: { damping: 12, mass: 0.4 }, durationInFrames: 6 });
  const level = LEVEL_STYLE[word.level ?? "normal"];
  // `fontSize` real, no `transform: scale()` — un scale visual no mueve el layout, así que una
  // palabra "critical" más grande se superponía con la de al lado en vez de empujarla (visto en
  // vivo: "NO" tapando "RECOMIENDO"). Con fontSize el navegador sí reserva el espacio real.
  const sizeFactor = level.scale * (word.size ?? 1) * interpolate(pop, [0, 1], [0.7, 1]);
  const opacity = interpolate(pop, [0, 1], [0, 1]);

  return (
    <span
      style={{
        fontFamily: level.font,
        letterSpacing: "0.01em",
        fontSize: CAPTION_BASE_SIZE * sizeFactor,
        lineHeight: 1.15,
        color: "white",
        textShadow: CAPTION_OUTLINE,
        display: "inline-block",
        opacity,
      }}
    >
      {word.text.toUpperCase()}
    </span>
  );
}

export { GOLD, GOLD_LIGHT, GREEN, RED };
