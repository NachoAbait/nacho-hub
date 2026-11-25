import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";

// Refresh de tipografía pedido por Nacho el 25-11-2026: el combo anterior (ArchivoBlack + Anton,
// las dos en mayúscula de palo ancha) lo sintió "aburrido" — pidió más cursiva y menos negrita. En
// vez de salir a buscar una tipografía nueva de cero, se usa la MISMA familia (Archivo, ya elegida
// para el resto del hub) en su corte itálico real: 500 itálica para lo normal, 700 itálica para
// keyword/critical — el énfasis sigue siendo tipografía + tamaño (nunca color, pedido explícito
// anterior que sigue en pie), solo que ahora es peso+itálica en vez de dos familias distintas.
const { fontFamily: CAPTION_FONT } = loadArchivo("italic", { weights: ["500"], subsets: ["latin"] });
const { fontFamily: KEYWORD_FONT } = loadArchivo("italic", { weights: ["700"], subsets: ["latin"] });

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

/** Ventana donde aparece el cartel de "100% original, sin cambios, sin arreglos" — pedido puntual
 * de Nacho (25-11-2026) para cuando dice esa frase. Igual regla que la caja de producto: nunca al
 * mismo tiempo que los subtítulos normales. */
export type BadgeSegment = { startFrame: number; endFrame: number };

/** Frame (de la composición entera) donde hay un corte duro entre dos tomas que Nacho ya exportó
 * unidas en un solo archivo — ver lib/video-editor/transitions.ts. En vez de dejar el corte seco, se
 * superpone un freeze-frame de la toma saliente que se desvanece con un empujón de zoom, revelando
 * la toma entrante (que el video de fondo ya está reproduciendo de verdad debajo). */
export type TransitionPoint = { frame: number };

/** Ventana donde se reemplaza el video de cámara normal por un clip especial YA compuesto (recorte
 * de Nacho sobre fondo blanco con subtítulos detrás, o sobre lluvia de billetes) — todo el trabajo de
 * segmentación/fondo/subtítulos de esa escena se hizo antes con Python (ver
 * scripts/tmp-fork/cutout_scene.py) porque mediapipe no corre adentro de Remotion/Chromium; acá solo
 * se reproduce el resultado ya armado en el momento justo, igual que cualquier otro clip. */
export type CutoutScene = { startFrame: number; endFrame: number; clipFileName: string };

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
  /** Ver BadgeSegment arriba. [] = nunca aparece. */
  badgeSegments?: BadgeSegment[];
  /** Ver TransitionPoint arriba. [] = sin tratamiento especial en los cortes (corte seco). */
  transitionPoints?: TransitionPoint[];
  /** Ver CutoutScene arriba. [] = todo el video usa la cámara normal. */
  cutoutScenes?: CutoutScene[];
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
const LEVEL_STYLE: Record<"normal" | "keyword" | "critical", { scale: number; font: string; weight: number }> = {
  normal: { scale: 1, font: CAPTION_FONT, weight: 500 },
  keyword: { scale: 1.16, font: KEYWORD_FONT, weight: 700 },
  critical: { scale: 1.32, font: KEYWORD_FONT, weight: 700 },
};

/**
 * Estilo "spotlight de producto" copiado de la competencia que Nacho mostró: fondo con el
 * presentador difuminado y oscurecido, una caja redondeada con borde que brilla (dorado neutro,
 * verde si lo que se dice en ese momento es positivo, rojo si es negativo — ver MOOD_COLORS) que
 * entra con un "flip" cada vez que cambia de producto, con la propia foto del producto agrandada y
 * difuminada de fondo detrás de la versión nítida.
 */
/** Cuánto dura el desvanecimiento del freeze-frame en una transición entre tomas — ver
 * TransitionPoint. 10 frames a 30fps = un tercio de segundo: se nota como transición intencional
 * sin sentirse lento ni "efecto de más" en un reel de 20-25s. */
const TRANSITION_LENGTH = 10;

export function ReelComposition({
  videoSrc,
  overlaySegments,
  moodSegments,
  phrases = [],
  badgeSegments = [],
  transitionPoints = [],
  cutoutScenes = [],
}: ReelCompositionProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const activeCutout = cutoutScenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null;
  const activeTransition = transitionPoints.find((t) => frame >= t.frame && frame < t.frame + TRANSITION_LENGTH) ?? null;
  const activeBadge = badgeSegments.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null;

  // Dos efectos combinados sobre el fondo: un "zoom de entrada" rápido en el primer medio segundo
  // (entra grande y se asienta, como pidió Nacho) + el drift lento tipo "Ken Burns" durante todo el
  // resto del clip, para que nunca se sienta una cámara fija.
  const entranceProgress = spring({ frame, fps, config: { damping: 20, mass: 0.7 }, durationInFrames: Math.round(fps * 0.6) });
  const entranceScale = interpolate(entranceProgress, [0, 1], [1.32, 1]);
  const driftScale = interpolate(frame, [0, durationInFrames], [1, 1.16], { extrapolateRight: "clamp" });
  const videoScale = entranceScale * driftScale;

  // Durante una escena especial (fondo blanco / lluvia de billetes) o el cartel de "sin cambios, sin
  // arreglos" no hay lugar para la caja de producto — mismo criterio que ya regía entre caja y
  // subtítulos ("sería mucha cosa" mostrar dos cosas a la vez), ahora con un tercer sistema visual.
  const activeOverlay = !activeCutout && !activeBadge ? overlaySegments.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null : null;
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
  const activePhrase =
    activeOverlay || activeCutout || activeBadge ? undefined : phrases.find((p) => frame >= p.startFrame && frame < p.endFrame);
  // La frase se va completando: todas las palabras cuyo `startFrame` ya pasó quedan en pantalla
  // juntas (no se reemplazan entre sí) hasta que termina la frase entera.
  const visibleWords = activePhrase?.words.filter((w) => frame >= w.startFrame) ?? [];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {activeCutout ? (
        // Escena especial ya compuesta entera por Python (recorte + fondo + subtítulos de esa
        // ventana, ver CutoutScene) — Sequence remapea el frame local a 0 para que el clip arranque
        // desde su propio principio, no desde el punto en que empieza a verse en el reel completo.
        <Sequence from={activeCutout.startFrame} durationInFrames={activeCutout.endFrame - activeCutout.startFrame}>
          <OffthreadVideo src={staticFile(activeCutout.clipFileName)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </Sequence>
      ) : (
        <>
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
          {/* Transición entre tomas (ver TransitionPoint): freeze de la toma saliente que se desvanece
              con un empujoncito de zoom, revelando la toma entrante que el layer de arriba ya está
              reproduciendo de verdad debajo — pedido explícito: los cortes que Nacho ya trae unidos en
              un solo archivo se sentían "bastante evidentes" sin esto. */}
          {activeTransition && (
            <Freeze frame={activeTransition.frame}>
              <OffthreadVideo
                src={staticFile(videoSrc)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: "blur(2px) brightness(0.78) saturate(0.95)",
                  transform: `scale(${videoScale * interpolate(frame - activeTransition.frame, [0, TRANSITION_LENGTH], [1, 1.045])})`,
                  opacity: interpolate(frame - activeTransition.frame, [0, TRANSITION_LENGTH], [1, 0]),
                }}
              />
            </Freeze>
          )}
          {/* Viñeta: oscurece los bordes (no el centro, donde está la cara) — dar sensación de foco sin
              tocar la nitidez real del video (eso lo arruinaría; la calidad del archivo se cuida en
              enhance.ts/render.ts con crf 16, no acá). */}
          <AbsoluteFill
            style={{ background: "radial-gradient(ellipse 85% 65% at 50% 32%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.5) 100%)" }}
          />
        </>
      )}

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

      {activeBadge && <Badge startFrame={activeBadge.startFrame} frame={frame} fps={fps} />}
    </AbsoluteFill>
  );
}

/** Cartel de "100% original, sin cambios, sin arreglos" — pedido puntual de Nacho (25-11-2026) para
 * cuando dice esa frase en el video. Mismo lenguaje visual que la caja de producto (tarjeta
 * redondeada, borde dorado que brilla, entra con un pop) pero sin foto, solo texto: no hace falta
 * salir a buscar un mockup/render externo para esto, el cartel propio ya cumple. */
function Badge({ startFrame, frame, fps }: { startFrame: number; frame: number; fps: number }) {
  const local = frame - startFrame;
  const pop = spring({ frame: local, fps, config: { damping: 14, mass: 0.5 }, durationInFrames: 12 });
  const scale = interpolate(pop, [0, 1], [0.75, 1]);
  const opacity = interpolate(pop, [0, 1], [0, 1]);

  return (
    // Arriba, no centrado: centrado le tapaba la cara (probado en vivo el 25-11-2026 — el cartel
    // quedaba justo sobre los ojos). Mismo "piso" que usan los subtítulos de la escena de fondo
    // blanco para quedar arriba de la cabeza sin pisar la cara.
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 300 }}>
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          background: "linear-gradient(160deg, #1a1308 0%, #000 70%)",
          border: `3px solid ${GOLD}`,
          boxShadow: `0 0 22px 8px ${GOLD}99, 0 0 56px 18px ${GOLD}55, inset 0 0 26px ${GOLD}33`,
          borderRadius: 32,
          padding: "36px 48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ fontFamily: KEYWORD_FONT, fontStyle: "italic", fontWeight: 700, fontSize: 52, color: "white", textAlign: "center" }}>
          100% ORIGINAL
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <div style={{ fontFamily: CAPTION_FONT, fontStyle: "italic", fontWeight: 500, fontSize: 30, color: GOLD_LIGHT }}>✓ Sin cambios</div>
          <div style={{ fontFamily: CAPTION_FONT, fontStyle: "italic", fontWeight: 500, fontSize: 30, color: GOLD_LIGHT }}>✓ Sin arreglos</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** Una palabra dentro de la frase que se va completando — su propio spring de entrada (pop chico,
 * no gira ni nada: la frase entera no tiene que sentirse como un carrusel, solo que cada palabra se
 * sume con un empujón breve) separado en su propio componente porque cada una necesita su propio
 * `spring()` con un frame relativo distinto (`frame - word.startFrame`), y eso solo es válido dentro
 * de un componente propio, no de un callback suelto dentro de .map(). */
// 48, no 54: pedido explícito junto con el cambio de tipografía ("cambiarle el tamaño") — la itálica
// de Archivo ya lee más estilizada a igual tamaño que la mayúscula de palo ancha de antes, así que
// bajarla un poco no resta legibilidad.
const CAPTION_BASE_SIZE = 48;

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
        fontStyle: "italic",
        fontWeight: level.weight,
        letterSpacing: "0.005em",
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
