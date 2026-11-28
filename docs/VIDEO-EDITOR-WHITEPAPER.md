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
   antes de transcribir o mejorar nada. Como corre antes de Whisper, todo lo que viene después ya
   trabaja sobre la línea de tiempo del clip YA recortado.
   - **Rediseño completo (27-11-2026):** pedido explícito — "corta los clips milisegundos antes de
     comenzar a hablar, que casi no haya silencios... entre clip y clip, no me cortes adentro de un
     mismo clip". `cutSilences` YA NO toca pausas de en medio de una misma toma (antes cortaba
     cualquier tramo ≥1s en todo el clip, con `MIN_SILENCE_SECONDS`) — ahora recorta ÚNICAMENTE el
     silencio ANTES de la primera palabra (tiempo muerto quieto a cámara antes de arrancar), con un
     umbral muy bajo (`LEADING_SILENCE_MIN_SECONDS = 0.03`) y un margen mínimo (`EDGE_PAD_SECONDS =
     0.04`, no los ~0.12s de antes) para que el corte caiga literalmente "milisegundos antes de hablar".
     `detectSilences` (el helper de más abajo) sigue existiendo tal cual para quien quiera ese chequeo
     más general (ver `qc.ts`, sección 5) — es informativo, ya no corta nada.
   - **Ampliado a las dos puntas (28-11-2026):** pedido explícito — "tenes que cortar los clips! ni
     bien termino de hablar en uno, y ni bien arranco a hablar en el proximo, pero justito justito"
     (confirmado después: esto corre automáticamente para CADA clip que procesa el pipeline, no es un
     caso especial de un video puntual — `cutSilences` se llama una vez por fila dentro del loop
     principal, `lib/agents/video-editor.ts`). `cutSilences` ahora también recorta el silencio DESPUÉS
     de la última palabra (si el clip termina en silencio real hasta el final del archivo), con el
     mismo umbral y el mismo `EDGE_PAD_SECONDS` que la punta inicial. Sigue sin tocar nada de en medio:
     solo cuenta como "punta final" un silencio cuyo `end` llegue hasta la duración total del archivo
     (lo que `detectSilences` ya reporta como el cierre de un `silence_start` sin `silence_end` propio)
     — una pausa real en medio del clip no cumple esa condición y queda intacta. El recorte de las dos
     puntas se hace en un solo paso de ffmpeg (`-ss` + `-t`, duración relativa) en vez de un `-ss` suelto,
     para no depender de cómo interpreta `-to` combinado con seek de salida.
   - **Compactación de pausas de EN MEDIO del clip, estándar desde el 28-11-2026:** pedido explícito,
     sobre un render donde el corte de solo las puntas (1.24s) se sintió insuficiente — "TENES QUE
     CORTARLO MUCHO MAS... por lo menos 3 mas". Esto REVIERTE el "no me cortes adentro de un mismo
     clip" del punto anterior: `cutSilences` ahora también compacta cualquier pausa de en medio
     ≥`MID_SILENCE_MIN_SECONDS` (0.3s — más corta que eso es respiración/prosodia normal, no se toca),
     dejando `MID_PAD_SECONDS` de aire real a cada lado en vez de silencio absoluto. Arrancó en 0.12
     (~0.24s de hueco total, para no sentirse como jump-cut seco) y bajó a **0.025 (~0.05s de hueco)**
     el mismo día, después de probar un corte manual mucho más ceñido en los puntos reales de cambio de
     toma de un clip real y que Nacho lo confirmara como el estándar que quiere de ahora en adelante:
     "los cortes estuvieron espectacular... así los quiero de ahora en adelante". Varias pausas en el
     mismo clip (no solo una al principio/final) necesitan recortar pedazos de EN MEDIO del archivo, así
     que ya no alcanza con un `-ss`/`-t` simple — se arma cada tramo a mantener con `trim`/`atrim` +
     `setpts`/`asetpts` y se unen con el filtro `concat` de ffmpeg.
   - **Bug encontrado el mismo día (27-11-2026):** desde que esta función existe, `probeDuration` usaba
     mal un flag de ffprobe (`noprint_wrapper` en vez de `noprint_wrappers`, sin la "s") — ffprobe
     tiraba error, el try/catch de `cutSilences` lo tragaba en silencio, y la función devolvía SIEMPRE
     el clip sin tocar. Es decir: **el corte de silencio nunca funcionó en ningún render anterior**,
     ni el general (1s) ni el inicial (0.2s) de la versión de ayer — todos los "corté Xs de silencio"
     que se reportaron antes de hoy eran en realidad "nada que cortar" por este bug, no por falta de
     silencio real. Ya está arreglado (una palabra, `noprint_wrappers`) y confirmado con un render real
     (0.69s de silencio inicial cortado). Moraleja para la próxima vez que algo de este pipeline
     "nunca encuentra nada que cortar/hacer": probar la función aislada con un `try/catch` que SÍ
     muestre el error, no confiar en que el try/catch defensivo del caller significa que no hay nada
     que hacer.
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
- **Posición vertical, regla permanente (28-11-2026):** `paddingBottom: 160` en `ReelComposition.tsx`
  (bajado de 340) — pedido explícito: "cuando aparecen los modelos... ponelos un poco mas abajo que me
  tapa la cara". Con 340 el borde superior de la caja quedaba a ~56% de la altura del cuadro, que en
  tomas donde Nacho sostiene los celulares cerca del pecho/mentón llegaba a superponerse con la cara;
  con 160 baja a ~65%. Si en el futuro el encuadre cambia mucho (otra silla, otra altura de cámara),
  revisar este valor con una captura real antes de asumir que sigue sirviendo.

## 3. Subtítulos

- **La oración se va completando palabra por palabra**, sin que las palabras anteriores desaparezcan,
  hasta terminar esa oración — ahí se limpia todo y arranca la siguiente (`ReelPhrase`/`ReelWord` en
  `ReelComposition.tsx`). Nunca "una palabra reemplaza a la anterior" (karaoke clásico).
- **Una oración a la vez, no un párrafo cargándose de a poco.** Cada ORACIÓN (la unidad de análisis
  semántico — ver más abajo) tiene un tope duro de **4 palabras / 1.7 segundos**
  (`MAX_SEGMENT_WORDS`/`MAX_SEGMENT_SECONDS` en `captions.ts`, bajado de 11→7 el 26-11-2026 y de 7→4 el
  28-11-2026 — pedido explícito, sobre un render con bloques de 7 palabras: "primer segundo y ya me
  pones una oracion de 7 palabras"), además de cortar por puntuación o pausa real (>0.45s) — así
  alguien hablando corrido sin comas no termina armando un solo bloque gigante de texto. Esto NO es
  volver al experimento de mini-bloques rotando de posición (ver el punto de abajo) — sigue siendo un
  solo bloque fijo arriba, simplemente más corto.
  - **Se probó y se revirtió: fragmentar en mini-bloques de 3 palabras (26-11-2026).** Hubo una
    versión que cortaba cada oración en bloques de máximo 3 palabras en pantalla, combinada con una
    posición que rotaba entre 3 zonas por bloque (ver más abajo) — se probó en un render real el mismo
    día y se revirtió: "no me gusta que ponga 2 palabras de un lado y de la nada salgas con una
    palabra abajo del todo, totalmente cruzada y opuesta... que termine la idea ahí arriba y abajo dos
    o tres palabras más". Esto último YA pasa solo con una oración completa (hasta 7 palabras) y el
    `flexWrap` de abajo, sin fragmentar nada — un bloque, una posición fija, que envuelve a una
    segunda línea más corta cuando hace falta. `buildPhrases` (`captions.ts`) vuelve a armar un
    `ReelPhrase` por oración completa, no por mini-bloque.
- **Sin colores.** Todo el texto es blanco con contorno negro sólido. El énfasis lo marcan SOLO
  tipografía y tamaño (`LEVEL_STYLE` en `ReelComposition.tsx`). Pedido explícito: "no uses tantos
  colores, solo con cambiar tipografía... y tamaño alcanza".
- **Tipografía (tercer refresco, 27-11-2026): Montserrat / Anton / League Spartan, no Playfair
  Display ni Fraunces.** Playfair Display y Fraunces quedaron descartadas sin vuelta atrás — no por un
  bug, por gusto: se armó un repertorio de 14 tipografías (trending Reels/TikTok 2026 + alternativas
  gratis a unas pagas que Nacho había visto en un reel ajeno) para que eligiera, y la respuesta fue
  "las de la primera página descártalas, son horribles" (esa página era justo Playfair + Fraunces).
  El reemplazo son todas sans bold en mayúscula, SIN itálica — el registro real de los Reels de
  producto (investigación 27-11-2026: "bold caps", nunca itálica/serifa para este formato, y Amazon
  mismo recomienda restricción en motion/tipografía para no perder confianza del comprador):
  - `CAPTION_FONT` = **Montserrat** peso 800 — base legible de "normal", citada en varias guías 2026
    como "la más versátil para captions de Reels".
  - `KEYWORD_FONT` = **Anton** — "keyword"/"critical", MISMA familia que usa `cutout_scene.py` en
    "detrás tuyo" (`FONT_PATH_PREMIUM`) para consistencia entre el texto de frente y el de atrás. Un
    solo peso (400, sin eje variable) — es de por sí ultra bold.
  - `ACCENT_FONT` = **League Spartan** peso 800 — variedad de familia para 1 de cada 3 oraciones
    (`accentFontFor`, determinístico por índice de frase). Se eligió, entre el repertorio, una
    geométrica bold DISTINTA de Anton pero del mismo registro "bold caps" — la vez anterior que se
    mezcló un registro elegante/itálico con uno de mayúscula ancha, Nacho lo rechazó ("totalmente
    cruzada y opuesta").
  - Las 6 tipografías elegidas por Nacho en pantallas de Instagram (Larken, Symphony Pro, Scholar,
    Cabrion Bold, Highrise Condensed, Galano Grotesque) eran TODAS pagas (foundries comerciales,
    US$19-400) — se descargaron equivalentes gratis (Libre Baskerville, Pinyon Script, Cormorant
    Garamond, Space Grotesk, Big Shoulders Display, Montserrat) a `scripts/video-editor/assets/` para
    tenerlas disponibles, pero NO se usaron en este refresco (no encajan en el registro "bold caps" que
    sí pidió para el pipeline real — son más bien serif/script elegante). Quedan ahí por si se arma
    algo con ese estilo más adelante.
- **El énfasis es semántico y tiene que leer el guión completo, no palabra por palabra aislada.**
  `caption-style.ts` (`classifyWordEmphasis`) le pasa a Claude el guión YA agrupado por oración real
  (mismo criterio que `content-analysis.ts`) para que primero entienda el rol de cada oración dentro
  de la historia completa (gancho, presentación de modelo, argumento de venta, cierre) y clasifique el
  énfasis según ESE rol — máximo 1 o 2 palabras "critical" por oración, la mayoría de las palabras de
  cualquier oración tienen que quedar en "normal". Si esto se siente azaroso otra vez, el problema está
  en que el prompt perdió el contexto de oración/guión completo, no en ajustar manualmente qué palabra
  es "importante".
  - **"Unterminated string in JSON" en clips largos — recurrente, visto dos veces (25-11 y
    28-11-2026).** `maxTokens` se quedaba corto para el JSON de un objeto por palabra en clips de
    ~190 palabras (subido de 4000→8000 la primera vez, no alcanzó siempre; ahora 16000). Además,
    `classifyWordEmphasis` reintenta UNA vez si el primer intento tira — el corte puede ser variación
    de esa tirada puntual, no solo falta de tokens. Cuando esto falla (incluso después del reintento),
    el render sigue con subtítulos planos (todo "normal") en vez de perderse — si un video sale con
    todas las palabras del mismo tamaño/tipografía, revisar el log por este error antes de asumir que
    el prompt dejó de funcionar.
- **Salida con spring, no corte seco (27-11-2026).** Investigación de motion graphics para este
  formato: "nunca interpolate() lineal, toda entrada con spring(), las salidas más rápidas que las
  entradas" — la entrada de cada palabra ya usaba `spring()` (bien), pero cuando terminaba una oración
  el bloque entero desaparecía de un frame al otro. Ahora `phraseExitOpacity`
  (`ReelComposition.tsx`) extiende la ventana 4 frames más allá de `endFrame` y desvanece el bloque con
  un `spring()` corto — más rápido que los 6 frames de entrada de cada palabra, como pide la
  investigación. Referencia de técnicas: `.reference/remotion-cinematic-skill` (clonado, no
  commiteado — ver `.gitignore`).
- **Sin efecto de sonido por palabra.** Se probó (pop sintetizado) y quedó mal — se sacó por completo.
  Si en el futuro se vuelve a pedir un sonido ahí, no reusar el enfoque viejo de `caption-pop.mp3`
  (seno sintético con ffmpeg) sin escuchar primero una muestra real con el usuario.
- **Posición: una sola zona fija, arriba (refresco 26-11-2026, ajustado el mismo día).** Antes:
  centrado, siempre a la misma altura fija (`paddingTop: 780`) — en varias tomas eso caía justo sobre
  la cara. Pedido explícito: "fijate que no me tapen la cara... ponelos más arriba". Se probó una
  versión que además ROTABA entre 3 zonas por bloque (arriba centrado / arriba izquierda / abajo sobre
  el pecho) buscando variedad — se revirtió el mismo día: el salto entre zonas de un bloque al
  siguiente se sentía "cruzado y opuesto", no dinámico (ver sección de arriba). `subtitleLayoutFor`
  (`ReelComposition.tsx`) quedó en UNA sola posición fija, arriba de donde normalmente está la cabeza
  — pensada para el encuadre habitual (sentado, cámara a la altura del pecho/cara), NO es seguimiento
  de cara en vivo (requeriría otra pasada de IA sobre el video) — si en una toma puntual el encuadre es
  muy distinto, puede volver a superponerse. Nunca al mismo tiempo que la caja de producto.
- **Números + "por ciento" → "N%" (26-11-2026).** `lib/video-editor/number-words.ts`
  (`mergePercentWords`) corre sobre la transcripción de Whisper ANTES de armar oraciones/análisis —
  reconoce el número dicho (en dígitos o deletreado, 0-999) seguido de "por ciento"/"porciento" y lo
  reemplaza por un solo token "N%", así todo lo demás (análisis, énfasis, subtítulos) ya lo ve como una
  palabra normal. Es "mejor esfuerzo" en la forma deletreada (cubre las formas habituales en español,
  no un parser numérico completo) — si no reconoce la forma exacta, deja las palabras como vinieron.
  - **Caso adicional (28-11-2026):** visto en vivo — Whisper a veces YA escribe "85%" en el texto
    completo del clip, pero en el array de palabras el símbolo "%" sale como su propio token de texto
    vacío pegado al número (no deletreado "por ciento", que es el único caso que cubría el párrafo de
    arriba) — sin esto, el subtítulo mostraba "85" solo, sin el signo. `mergePercentWords` ahora
    también detecta un token vacío justo después de un número puro y lo fusiona como "%". Queda sin
    cubrir el caso (visto en el mismo clip, en otra instancia de "85%") donde Whisper pierde el símbolo
    del todo, sin dejar ni token vacío — no hay señal ninguna en el array de palabras para recuperarlo
    de forma confiable.

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
- **1 o 2 palabras, bien grandes — nunca la oración entera (refresco 26-11-2026).** Pedido explícito
  tras ver el primer render real: "generalmente cuando ponés un subtítulo atrás mío, es alguna palabra
  o a lo sumo 2 palabras bien grandes, representando la idea principal de la frase, no poniendo una
  oración entera en la parte de atrás". `buildDepthScenes` elige la(s) palabra(s) "critical" de esa
  oración (mismo criterio semántico que la sección 3), o "keyword" si no hay ninguna "critical", o la
  palabra más larga como último recurso — nunca más de `MAX_KEYWORDS = 2`. Aparecen juntas desde el
  arranque de la escena y quedan fijas (no se completan palabra por palabra como el resto del video:
  son 1-2 palabras sueltas) con un tamaño de letra bastante más grande (`scale=0.11` en
  `cutout_scene.py`, antes 0.062, que sigue siendo el tamaño para whitebg/moneyrain que sí llevan
  oraciones completas).
- Por cada una elegida, llama a `scripts/video-editor/cutout_scene.py --mode depth` (MediaPipe Selfie
  Segmentation, mismo segmentador que usan las escenas manuales de la sección 6) — el "fondo" sobre
  el que se dibuja el subtítulo es el FRAME REAL tal cual, no uno nuevo: el texto queda atrás solo
  porque la persona recortada se superpone encima en la misma composición.
- El resultado (un .mp4 corto ya compuesto) se agrega como `cutoutScenes` — mismo mecanismo que ya
  usaban las escenas manuales de whitebg/moneyrain (`ReelComposition.tsx` las reproduce en vez de la
  cámara normal durante esa ventana, con prioridad sobre el subtítulo normal).
- **Bug real encontrado y arreglado (26-11-2026): "pantalla verde".** El primer render real mostró un
  tinte verdoso/enfermizo en estas escenas. Causa: el clip que arma `cutout_scene.py` salía sin
  ninguna etiqueta de color (`color_space=unknown`), mientras que el video original de un iPhone SÍ
  viene etiquetado `bt709` — Remotion interpretaba mal el clip sin etiqueta al insertarlo en el render
  final. Arreglo: el encode final de `cutout_scene.py` ahora fuerza `-color_primaries/-color_trc/
  -colorspace bt709` (el estándar real de un iPhone, no una suposición al voleo).
- **Segundo bug real encontrado y arreglado (26-11-2026): texto cortado por el pelo.** Con la altura
  fija (`0.33` del alto del cuadro) un "NO" quedó partido al medio por el límite de la máscara de
  recorte — esa toma puntual tenía a Nacho más inclinado/cerca de cámara que de costumbre, con el pelo
  más arriba de lo habitual. Arreglo: `draw_caption` ahora recibe `person_top` (la fila más alta con
  alpha fuerte EN ESE FRAME puntual, calculado en el loop principal) y el texto nunca baja más de
  `person_top` menos un margen, aunque eso signifique subir por encima de la altura "ideal" — puede
  solaparse con el logo de fondo en vez del pelo, que se ve mucho mejor que el texto partido a la
  mitad.
- **Tipografía (27-11-2026): Anton, no Playfair Display.** Mismo refresco de la sección 3 —
  `FONT_PATH_PREMIUM` en `cutout_scene.py` apunta ahora a `assets/Anton-Regular.ttf`. Anton es de un
  solo peso fijo (sin eje `wght`), así que el parámetro `weight=750` que se le pasa a `draw_caption` no
  hace nada para esta fuente — el try/except de `set_variation_by_axes` lo absorbe sin romper nada
  (ver el código, ya documentado como "inalcanzable pero inofensivo" desde el refresco anterior).
  (Historial: 26-11-2026 había reemplazado Archivo por Playfair Display acá con el mismo mecanismo —
  este refresco del 27-11-2026 reemplaza Playfair por Anton, no vuelve a Archivo.) whitebg/moneyrain
  (manuales, ver sección 6) siguen con Archivo — no se tocaron, no es lo que Nacho está mirando a
  diario.
- Nunca tira: sin `selfie_segmenter.tflite` instalado, o si python3/mediapipe fallan, esa oración
  sigue con el subtítulo normal (de frente) en vez de perder el render.
- Verificado con capturas de frames reales de un clip real el 26-11-2026 (ver commit) antes de darlo
  por bueno — no alcanzaba con que compilara. Esta sección recién corrió dentro de una corrida real
  completa del agente ese mismo día (antes solo se había probado en una ventana fabricada a mano).

## 5. QC automático antes de dar un render por bueno

`lib/video-editor/qc.ts` (`runQc`), corre en cada clip dentro de `lib/agents/video-editor.ts` antes de
marcarlo `done`. Nunca bloquea el render — un chequeo que falla queda bien visible en el log y en el
reporte (`🔍 QC: ...`), no hace perder el clip. Chequeos de hoy:

1. **Todos los modelos nombrados tienen foto** — usa `missingPhotos` de `buildContentTimeline`.
2. **Ventanas de producto dentro del video** — ningún `overlaySegment` arranca antes de 0, termina
   después del final del video, ni tiene `start >= end`.
3. **Subtítulos sincronizados con sus propios límites** — ninguna frase sale del rango del video, y
   ninguna palabra queda fuera de los límites de su propia frase.
4. **Sin tiempo muerto largo antes de la primera palabra** (actualizado 27-11-2026, ver sección 1) —
   desde que `cutSilences` dejó de tocar pausas de en medio de una toma (pedido explícito), este
   chequeo YA NO busca "cualquier silencio ≥1s sin cortar" en todo el video (eso va a pasar siempre
   que haya una pausa real, y ahora es lo esperado) — solo confirma que el silencio INICIAL quedó
   recortado.

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

## 6b. Motion graphics: categoría, herramienta y cómo pedirlos (28-11-2026)

**Nombre de la categoría.** Todo lo de este archivo que reemplaza al subtítulo plano palabra por
palabra (la caja de producto, el Badge "100% ORIGINAL", el Panel Checklist de abajo, y lo que se
sume a futuro — una línea de tiempo, etc.) es, como categoría, un **"motion graphic"** — pedido
explícito de Nacho de tener un nombre para pedirlos sin saber el detalle técnico: *"hacé un motion
graphic acá"* y después el tipo (o una descripción si no sabe el nombre exacto, y se lo pone quien
esté implementando). Catálogo de los que ya existen:

| Nombre | Qué es | Dónde vive |
|---|---|---|
| Caja de producto | Tarjeta con el render del celular nombrado | `activeOverlay` en `ReelComposition.tsx` |
| Badge | Cartel "100% ORIGINAL / Sin cambios / Sin arreglos" | `Badge` en `ReelComposition.tsx` |
| **Panel Checklist** | Lista que se arma item por item (ver abajo) | `ChecklistPanel` en `ReelComposition.tsx` |
| Escena "detrás tuyo" | Recorte sobre fondo especial (blanco, billetes) | `cutout_scene.py` + `CutoutScene` |

**Herramienta: Remotion se queda.** Investigado explícitamente a pedido de Nacho (28-11-2026,
"investiga la mejor herramienta para hacerlo"): Remotion sigue siendo la opción vigente para
generar video programáticamente vía código (no GUI tipo After Effects) en 2026 — es lo que recomienda
la comparación de alternativas de la categoría, y Remotion mismo sacó "Agent Skills" oficiales en
enero 2026 pensadas justo para que un agente de código como este escriba Remotion bien. No hay
necesidad de migrar a otra cosa. Para coreografías más complejas que un fade/scale/translate (texto
que se parte en letras, máscaras de revelado, efectos reusables con nombre) existe `@remotion/gsap`
(wrapper oficial de GSAP, determinístico frame por frame) — no hace falta hoy, el `spring()`/
`interpolate()` a mano ya cubre todo lo que se pidió hasta ahora; vale la pena si en algún momento se
pide algo bastante más coreografiado que una lista o un cartel. Contrapunto a tener en cuenta: el
mismo research marca que un exceso de efectos/pulido hoy se lee como "genérico/hecho por IA" — texto
legible y restraint le está ganando a la persecución de tendencias visuales en 2026. No sumar motion
por sumar.

**Cuándo usarlos — pedido explícito: "quiero usarlos siempre que interpretes que algo se puede hacer
con eso, algo importante, algun proceso, enumeracion de listas".** De acá en más, antes de dar una
edición por terminada, mirar la transcripción completa del clip (no solo mientras se arma, a
propósito) buscando candidatos: un punto importante que se podría resaltar como cartel/callout, un
proceso con pasos (candidato a algo tipo "Timeline"), una enumeración de características o ítems
(candidato a Panel Checklist). Esto es una sugerencia activa, no silenciosa: **mostrarle a Nacho los
candidatos encontrados ANTES de tocar el render** (mismo patrón que ya se usó para el Panel
Checklist: "primero enumeramelos aca a ver si estan bien antes de tocar algo") y esperar su
confirmación de cuáles sí y de qué tipo, en vez de meter motion graphics por iniciativa propia sin
mostrarlos primero.

**Panel Checklist — qué es y cómo se arma.** Pedido puntual (28-11-2026) para cuando Nacho enumera
una lista de características ("de primera mano, sin cambios, sin arreglos, estéticamente impecables,
batería arriba del 85%") — en vez de que pase como subtítulo plano, una tarjeta fija (mismo lenguaje
visual que la caja de producto/Badge: fondo oscuro, borde, tipografía Montserrat 800) que va sumando
filas una por una, cada una con un círculo verde con tilde (o un ícono de caja de Apple para "de
primera mano / con su caja original" — pedido puntual: "podrias poner una caja original de apple").

- **Tipos**: `ChecklistPanelItem`/`ChecklistPanelSegment` en `ReelComposition.tsx`,
  `ChecklistPanelItemInput`/`ChecklistPanelSegmentInput` en `render.ts` (conversión segundos→frames
  como cualquier otro segmento). Prop nueva `checklistPanels` en `ReelCompositionProps`/
  `RenderReelInput`, `[]` por default — no afecta ningún render que no lo pida.
- **Timing real, no un intervalo fijo**: cada item tiene su propio `revealFrame`/`revealSec`, anclado
  a la palabra real donde Nacho empieza a nombrar esa característica en el audio (ver la transcripción
  de Whisper de ese clip) — pedido explícito: "que no aparezcan de una, que vayan apareciendo las
  características a medida que voy nombrándolas".
- **Nunca junto a los subtítulos normales ni a la caja de producto** — mismo criterio que el Badge:
  `activeChecklistPanel` entra a la misma exclusión mutua (`activeOverlay`/`activeCutout`/
  `activeBadge`/`activeChecklistPanel`, ver `ReelComposition.tsx`).
- **Genérico, reusable — los DATOS no**. El componente no asume que el contenido sea siempre "cómo
  tomamos los usados": cualquier lista futura arma su propio `ChecklistPanelSegment`. Lo que sí sigue
  siendo manual por ahora es la lista de items y sus tiempos — no hay detección automática de "esto es
  una enumeración" todavía (ver el punto de arriba: la propuesta es manual/conversacional, no un paso
  de `content-analysis.ts` nuevo).
- **Previsualizado antes de tocar código real**: se armó primero un mockup HTML animado (Artifact,
  con las mismas fuentes/colores del video) para que Nacho aprobara el diseño y el timing de la
  animación ANTES de escribir el componente de Remotion — vale la pena repetir este paso para
  cualquier motion graphic nuevo que no sea un ajuste chico de uno que ya existe: es mucho más rápido
  iterar en HTML que re-renderizando el video entero cada vez.

## 7. Pendiente / no resuelto

- iPhone 13 mini, 13 Pro, 13 Pro Max y 14 Plus no tienen foto en ningún lado (ni CDN de Apple, que los
  retiró, ni biblioteca local) — si Nacho los nombra, el QC los va a marcar como `missingPhotos` y hay
  que generarles una imagen IA como se hizo con el iPhone 13 simple.
- El corte de silencios se reescribió por completo el 27-11-2026 (sección 1) — ahora solo toca el
  silencio inicial, nunca pausas de en medio. Confirmado con un render real (0.69s cortado) después de
  arreglar el bug de `probeDuration`, pero todavía vale la recomendación de siempre: revisar el log
  (`corté Xs de silencio...`) contra el clip original antes de dar algo por bueno a ciegas.
- Quedó sin uso el `MIN_SILENCE_SECONDS` (pausas de en medio, ≥1s) que antes cortaba `cutSilences` —
  si en algún momento Nacho pide volver a cortar esas pausas (hoy pidió explícitamente lo contrario:
  "no me cortes adentro de un mismo clip"), el código de referencia está en el historial de git de
  `silence-cut.ts` antes del 27-11-2026, no hay que reinventarlo.
- El efecto "detrás tuyo" automático (sección 4b) ya corrió una vez de punta a punta dentro de una
  corrida real del agente (26-11-2026) — el criterio de selección (1 de cada 4, tope 3 por video)
  sigue siendo un primer número, no algo afinado todavía: si con más videos reales se siente repetido
  o mal ubicado, ajustar `EVERY_NTH_ELIGIBLE`/`MAX_DEPTH_SCENES_PER_CLIP` en `depth-captions.ts`.
- La posición fija de los subtítulos normales (sección 3, `subtitleLayoutFor`) es una zona segura
  pensada para el encuadre habitual de Nacho (sentado, cámara a la altura del pecho/cara) — si graba
  parado, muy cerca, o con un encuadre bien distinto al de siempre, puede volver a superponerse con la
  cara. No hay detección de cara en vivo todavía (sí lo hay para el efecto "detrás tuyo" — ver
  `person_top` en la sección 4b — porque ahí ya se calcula la máscara de la persona por otro motivo;
  traer esa misma lógica acá sería la forma de resolver esto si vuelve a pasar).
- El parser de números deletreados de `number-words.ts` (para "noventa y nueve por ciento" → "99%")
  cubre las formas habituales en español hasta 999, pero es "mejor esfuerzo" — una forma rara o mal
  transcripta por Whisper puede no mergearse (queda el texto tal cual vino, no rompe el render).
