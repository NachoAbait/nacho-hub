# Franco (Video Editor) — estándar para todos los videos

Este documento es la referencia única de cómo tiene que salir CUALQUIER video que procese Franco, de
acá en adelante. No es un historial de lo que se probó — es lo que ya quedó definido y estable. Si
algo de esto cambia por un pedido nuevo de Nacho, se actualiza este archivo en el mismo commit que el
código, y el QC automático (`lib/video-editor/qc.ts`) se ajusta si el chequeo correspondiente existe.

Antes de dar por buena una versión nueva de CUALQUIER pieza de este pipeline, revisar esta lista
contra lo que de verdad hace el código (no contra lo que se recuerda que hacía) y, si hay cambios de
comportamiento visible, verificar con capturas de frames reales — no alcanza con que compile o con
mirar un solo frame suelto.

## 1. Orden del pipeline

1. **Cortar silencios** (`lib/video-editor/silence-cut.ts`, `cutSilences`) — SIEMPRE lo primero,
   antes de transcribir o mejorar nada. Corta tramos de silencio de **1 segundo o más** (con ~0.12s de
   margen de cada lado para no comerse el ataque de una palabra), no todo silencio — las pausas cortas
   y naturales de alguien hablando a cámara se dejan como están. Como corre antes de Whisper, todo lo
   que viene después ya trabaja sobre la línea de tiempo del clip YA recortado.
   - **Silencio inicial (refresco del 26-11-2026):** el tramo ANTES de la primera palabra no es una
     pausa a proteger — ahí todavía no hay nadie hablando, es tiempo muerto quieto mirando a cámara.
     Pedido explícito: "hay fracciones de segundo antes de que comience a hablar y queda feo". Por eso
     se evalúa aparte con un umbral mucho más bajo (`LEADING_SILENCE_MIN_SECONDS = 0.2`, no 1s) — solo
     para el silencio que arranca en el segundo 0 del clip, el resto del video sigue protegido por el
     umbral de 1s de siempre.
2. **Mejora de imagen tipo "Enhance" de CapCut** (`lib/video-editor/enhance.ts`, `enhanceClip`) —
   contraste/brillo/saturación + nitidez (unsharp mask). Esto es lo que de verdad mejora la imagen; la
   "calidad 4K/HD" de CapCut es solo resolución de exportación, no hace nada por sí sola.
3. **Transcripción** (Whisper, `lib/video-editor/captions.ts`) — palabras con timestamp + oraciones
   reales armadas a partir de esas palabras (no el `segments` nativo de Whisper, que corta por
   ventanas de ~30s y mezcla varias ideas).
4. **Análisis semántico** — qué modelo(s) se nombra en cada oración y con qué tono
   (`content-analysis.ts`), y qué énfasis le corresponde a cada palabra dentro de su oración
   (`caption-style.ts`). Ver sección 3.
5. **Render** (`render.ts`) — `crf: 16` (casi sin pérdida; el default de Remotion es ~23, visible).
6. **QC automático** (`qc.ts`) antes de marcar el clip como listo. Ver sección 5.

## 2. Aparición de modelos de celular en la caja de producto

Esto ya quedó confirmado como estándar (no es un tema abierto):

- La caja aparece exactamente cuando se nombra un modelo, no repartiendo el tiempo de la oración en
  partes iguales (`anchorOverlaySegments` en `product-match.ts`): busca la palabra real (el número del
  modelo, o el último token del nombre) y ancla ahí.
- **TODOS** los modelos que Nacho nombra tienen que aparecer, estén o no en el catálogo que vende hoy
  BNB. `getActiveCatalog()` solo trae lo que está activo en `products`; `model-image-library.ts`
  (`withExtraModels`) suma una biblioteca aparte de "modelos que se nombran pero no se venden" (hoy:
  iPhone 14, 14 Pro, 14 Pro Max con foto real de Apple; iPhone 13 con una imagen generada por IA,
  marcada como placeholder de menor calidad). Si Nacho nombra un modelo que no está en ninguna de las
  dos listas, el QC (sección 5) lo marca como `missingPhotos` — en ese caso hay que buscarle/generarle
  una foto a mano (mismo proceso que se usó para el iPhone 13) y sumarla a `model-image-library.ts`.
- Ventana mínima de 0.6s por modelo aunque se nombren varios muy rápido seguidos, para que la caja
  llegue a asentarse (flip-in de 0.35s) antes de cambiar — si no, se siente desincronizada aunque el
  ancla sea exacta.
- Nunca al mismo tiempo que los subtítulos — "sería mucha cosa" mostrar las dos cosas juntas cuando se
  está mostrando el render de un celular.

## 3. Subtítulos

- **La oración se va completando palabra por palabra**, sin que las palabras anteriores desaparezcan,
  hasta terminar esa oración — ahí se limpia todo y arranca la siguiente (`ReelPhrase`/`ReelWord` en
  `ReelComposition.tsx`). Nunca "una palabra reemplaza a la anterior" (karaoke clásico).
- **Una oración a la vez, no un párrafo cargándose de a poco.** Cada frase en pantalla tiene un tope
  duro de **7 palabras / 3 segundos** (`MAX_SEGMENT_WORDS`/`MAX_SEGMENT_SECONDS` en `captions.ts`,
  bajado de 11/4.5 el 26-11-2026 — pedido explícito: "no quiero que aparezcan más de 6/7 palabras en
  una oración"), además de cortar por puntuación o pausa real (>0.45s) — así alguien hablando corrido
  sin comas no termina armando un solo bloque gigante de texto.
- **Sin colores.** Todo el texto es blanco con contorno negro sólido. El énfasis lo marcan SOLO
  tipografía y tamaño (`LEVEL_STYLE` en `ReelComposition.tsx`). Pedido explícito: "no uses tantos
  colores, solo con cambiar tipografía... y tamaño alcanza".
- **Tipografía (refresco del 25-11-2026):** Archivo itálica, dos pesos — 500 para "normal", 700 para
  "keyword"/"critical" — en vez del combo anterior (ArchivoBlack + Anton, las dos en mayúscula de
  palo ancha). Pedido explícito: "más cursiva, no tanto negrita, que es medio aburrido". Tamaño base
  48 (antes 54). El criterio de CUÁNTO énfasis (1-2 palabras "critical" por oración, el resto
  "normal") no cambió, solo cómo se ve.
  - **Variedad de familia (refresco del 26-11-2026):** pedido explícito "quiero que el editor combine
    fuentes, tamaños" (con el ejemplo de un reel de Instagram). La palabra "critical" de 1 de cada 3
    oraciones usa Fraunces itálica en vez de Archivo itálica (`accentFontFor` en
    `ReelComposition.tsx`, determinístico por índice de frase, no al azar en cada render). "normal" y
    "keyword" siguen siempre en Archivo — es la base legible de la frase, nunca cambia.
- **El énfasis es semántico y tiene que leer el guión completo, no palabra por palabra aislada.**
  `caption-style.ts` (`classifyWordEmphasis`) le pasa a Claude el guión YA agrupado por oración real
  (mismo criterio que `content-analysis.ts`) para que primero entienda el rol de cada oración dentro
  de la historia completa (gancho, presentación de modelo, argumento de venta, cierre) y clasifique el
  énfasis según ESE rol — máximo 1 o 2 palabras "critical" por oración, la mayoría de las palabras de
  cualquier oración tienen que quedar en "normal". Si esto se siente azaroso otra vez, el problema está
  en que el prompt perdió el contexto de oración/guión completo, no en ajustar manualmente qué palabra
  es "importante".
- **Sin efecto de sonido por palabra.** Se probó (pop sintetizado) y quedó mal — se sacó por completo.
  Si en el futuro se vuelve a pedir un sonido ahí, no reusar el enfoque viejo de `caption-pop.mp3`
  (seno sintético con ffmpeg) sin escuchar primero una muestra real con el usuario.
- Posición: centrado, pegado a la parte de arriba de la mitad inferior del cuadro (`paddingTop: 780`),
  nunca superpuesto con la caja de producto.

## 4. Imagen y efectos

- `crf: 16` en LAS DOS pasadas de compresión (`enhance.ts` / `silence-cut.ts` como primer paso, y
  `render.ts` como paso final) — nunca el default de ffmpeg/Remotion (~23), se nota y se acumula.
- Zoom de entrada (spring de 1.32x a 1x en 0.6s) + drift lento tipo Ken Burns durante todo el clip
  (hasta 1.16x) sobre el fondo — es movimiento de cámara, no un filtro de imagen, sigue en pie.
- **Sin filtro de color ni viñeta sobre el video principal (sacados el 26-11-2026).** Antes había un
  `filter: blur(2px) brightness(0.78) saturate(0.95)` + una viñeta oscura en los bordes, siempre,
  automático — pedido explícito: "en cuanto a filtros e imagen no se toque nada". `enhance.ts` (paso
  2 del pipeline) sigue siendo el ÚNICO lugar que mejora la imagen de verdad (contraste/brillo/
  saturación + nitidez real, no un filtro CSS encima) — eso no cambió, solo se sacó la capa extra que
  además de `enhance.ts` seguía alterando el video en `ReelComposition.tsx`.
- Caja de producto: "spotlight" — la misma foto del producto de fondo (difuminada, agrandada) +
  versión nítida encima, con reflejo tenue debajo. Borde y brillo según el tono detectado (dorado
  neutro / verde positivo / rojo negativo). Esto es un efecto de la CAJA, no del video de fondo — no
  lo afecta el punto anterior.

## 4b. Subtítulo "detrás tuyo" (automático, 26-11-2026)

Pedido explícito, con el ejemplo de un reel de Instagram: a veces (no siempre) el subtítulo tiene que
quedar DETRÁS de Nacho, con el fondo real sin tocar (ni blanco, ni difuminado nuevo, ni ningún
filtro) — distinto de las escenas especiales manuales de la sección 6 (que sí reemplazan todo el
fondo por uno nuevo).

- `lib/video-editor/depth-captions.ts` (`buildDepthScenes`) corre automático para CUALQUIER video,
  dentro de `buildContentTimeline` (`lib/agents/video-editor.ts`) — no depende de que haya catálogo
  ni de que se detecte ningún modelo, solo de que haya oraciones elegibles.
- Elige **1 de cada 4** oraciones elegibles (`EVERY_NTH_ELIGIBLE`), con un tope de **3 por video**
  (`MAX_DEPTH_SCENES_PER_CLIP`) — oraciones de al menos 1.2s, y nunca durante una ventana donde ya
  está la caja de producto (se pisarían).
- Por cada una elegida, llama a `scripts/video-editor/cutout_scene.py --mode depth` (MediaPipe Selfie
  Segmentation, mismo segmentador que usan las escenas manuales de la sección 6) — el "fondo" sobre
  el que se dibuja el subtítulo es el FRAME REAL tal cual, no uno nuevo: el texto queda atrás solo
  porque la persona recortada se superpone encima en la misma composición.
- El resultado (un .mp4 corto ya compuesto) se agrega como `cutoutScenes` — mismo mecanismo que ya
  usaban las escenas manuales de whitebg/moneyrain (`ReelComposition.tsx` las reproduce en vez de la
  cámara normal durante esa ventana, con prioridad sobre el subtítulo normal).
- Nunca tira: sin `selfie_segmenter.tflite` instalado, o si python3/mediapipe fallan, esa oración
  sigue con el subtítulo normal (de frente) en vez de perder el render.
- Verificado con capturas de frames reales de un clip real el 26-11-2026 (ver commit) antes de darlo
  por bueno — no alcanzaba con que compilara.

## 5. QC automático antes de dar un render por bueno

`lib/video-editor/qc.ts` (`runQc`), corre en cada clip dentro de `lib/agents/video-editor.ts` antes de
marcarlo `done`. Nunca bloquea el render — un chequeo que falla queda bien visible en el log y en el
reporte (`🔍 QC: ...`), no hace perder el clip. Chequeos de hoy:

1. **Todos los modelos nombrados tienen foto** — usa `missingPhotos` de `buildContentTimeline`.
2. **Ventanas de producto dentro del video** — ningún `overlaySegment` arranca antes de 0, termina
   después del final del video, ni tiene `start >= end`.
3. **Subtítulos sincronizados con sus propios límites** — ninguna frase sale del rango del video, y
   ninguna palabra queda fuera de los límites de su propia frase.
4. **Sin silencios largos (≥1s) sin cortar** — corre `detectSilences` de nuevo sobre el clip YA
   cortado+mejorado; si sigue encontrando algo, el corte de silencios falló o no corrió.

Esto es el chequeo automático que corre SIEMPRE, sin un humano mirando. No reemplaza la revisión
manual de un cambio nuevo al propio pipeline — eso sigue necesitando capturas de frames reales en
momentos puntuales (arranque/final de una ventana de producto, mitad de una frase larga) antes de
mandar cualquier versión nueva, como pidió Nacho explícitamente para no iterar a ciegas.

## 6. Transiciones, cartel de texto y escenas especiales (25-11-2026)

Nacho empezó a subir sus tomas ya unidas en un solo archivo (en vez de un clip por toma) — los
cortes internos quedaban "bastante evidentes". Se sumaron tres capacidades nuevas, todas opcionales
(listas vacías = comportamiento de siempre):

- **Transiciones entre cortes duros** (`lib/video-editor/transitions.ts`, `detectHardCuts` — ffmpeg
  `select='gt(scene,0.1)'` sobre el clip YA cortado/mejorado, nunca el crudo). Cada corte detectado
  se pasa como `transitionPoints` a `renderReel`; `ReelComposition.tsx` superpone un freeze-frame de
  la toma saliente que se desvanece con un empujón de zoom (`TRANSITION_LENGTH` = 10 frames) en vez
  de dejar el corte seco.
- **Cartel de texto anclado a una frase literal** (`findPhraseWindow` en `product-match.ts` — busca
  texto exacto palabra por palabra en toda la transcripción, no el match de modelo por oración de
  `content-analysis.ts`). Hoy lo usa el cartel "100% ORIGINAL / Sin cambios / Sin arreglos"
  (`BadgeSegment`/`Badge` en `ReelComposition.tsx`) cuando Nacho dice esa frase — mismo lenguaje
  visual que la caja de producto (tarjeta, borde dorado) pero sin foto. Arriba de la cabeza, no
  centrado: centrado le tapaba la cara.
- **Escenas especiales recortando a Nacho del fondo** (fondo blanco con subtítulos detrás de él, o
  lluvia de billetes con él adelante) — `scripts/video-editor/cutout_scene.py`. MediaPipe no corre
  adentro de Remotion/Chromium, así que esto NO pasa por la composición en vivo: un script Python
  aparte segmenta persona/fondo frame por frame (Selfie Segmentation, Tasks API — la versión
  "legacy" `mp.solutions` ya no existe en mediapipe 1.x), compone sobre el fondo nuevo, y el
  resultado es un .mp4 normal que `CutoutScene` en `ReelComposition.tsx` reproduce durante esa
  ventana en vez de la cámara (`Sequence` remapea el frame local a 0). Notas de la implementación:
  - La categoría de persona del modelo es la **0**, no la 1 — falso a primera vista, confirmado
    componiendo las dos opciones contra un frame real.
  - Limpieza de máscara: solo el componente conexo que toca el borde inferior del cuadro (Nacho
    siempre llega hasta ahí sentado; un objeto de fondo como el logo de Apple en la pared, no) +
    cierre/apertura morfológica + blur + mezcla con el alpha del frame anterior (reduce parpadeo).
  - Los subtítulos de estas escenas van UNA ORACIÓN A LA VEZ (`--captions` recibe grupos por
    oración, no una lista plana) — con todo el guión en una sola lista acumulándose, una escena de
    varios segundos con dos oraciones seguidas hacía que la última línea (la palabra más importante,
    "imposible") se saliera del cuadro por abajo. Mismo principio que la sección 3 de arriba, aplicado
    acá a mano porque este script no reusa `captions.ts`.
  - **Esto no está enganchado al cron automático** — qué frase dispara qué efecto depende del guión
    de cada video puntual, no es una regla general. Se corre a mano (ver comentario de uso en el
    propio script) cuando Nacho pide un efecto así para un video nuevo.

## 7. Pendiente / no resuelto

- iPhone 13 mini, 13 Pro, 13 Pro Max y 14 Plus no tienen foto en ningún lado (ni CDN de Apple, que los
  retiró, ni biblioteca local) — si Nacho los nombra, el QC los va a marcar como `missingPhotos` y hay
  que generarles una imagen IA como se hizo con el iPhone 13 simple.
- El corte de silencios es nuevo (sección 1, paso 1) — la primera vez que corra sobre clips reales,
  conviene revisar con atención el log (`corté Xs de silencio...`) y comparar contra el clip original
  para confirmar que no se comió ninguna palabra, no solo confiar en que el código "debería" andar.
- El efecto "detrás tuyo" automático (sección 4b) es nuevo el 26-11-2026 — probado con un clip real
  en una ventana fabricada a mano, pero todavía no corrió dentro de una corrida real del agente
  (Drive → Whisper → Claude → render). La primera vez que lo haga, revisar en qué oraciones eligió
  meterlo y si se siente repetido o mal ubicado (ej. muy pegado a otra escena especial) — el criterio
  de selección (1 de cada 4, tope 3) es un primer número, no algo ya validado en video real completo.
