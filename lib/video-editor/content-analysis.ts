import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import type { WhisperSegment } from "@/lib/video-editor/captions";

const AnalysisSchema = z.object({
  segments: z.array(
    z.object({
      index: z.number(),
      // Array, no un solo string: una frase real puede nombrar varios modelos seguidos ("te
      // recomiendo el 16, el 17 Pro y el 14 Pro") — con un solo campo, Claude tenía que elegir uno
      // y los demás se perdían en silencio. Visto en vivo con un clip real de Nacho.
      product_models: z.array(z.string()),
      // TODOS los modelos de celular que se nombran en la oración, estén o no en el catálogo (a
      // diferencia de `product_models`, que solo trae los del catálogo) — es lo único que permite
      // detectar "mencionó un modelo que no tengo" en vez de que se pierda en silencio porque Claude
      // nunca lo tuvo como opción para reportar.
      all_mentioned_models: z.array(z.string()),
      sentiment: z.enum(["positive", "negative", "neutral"]),
    }),
  ),
});

export interface ContentSegmentResult {
  index: number;
  productModels: string[];
  allMentionedModels: string[];
  sentiment: "positive" | "negative" | "neutral";
}

/**
 * Le pasa a Claude la transcripción oración por oración (texto nomás — Claude no "ve" el clip,
 * analiza lo que Nacho dijo) junto con el catálogo real de modelos activos, y le pide que diga de
 * qué modelo habla cada oración (o `null` si no menciona ninguno del catálogo) y en qué tono —
 * positivo, negativo o neutro — lo dice. Así la caja de producto y el color de la caja siguen lo que
 * se está diciendo en cada momento del video, en vez de un solo producto fijo para todo el clip
 * (que era lo que hacía matchOverlay por nombre de archivo).
 *
 * Nunca tira por falta de datos: con `segments` vacío devuelve `[]` sin llamar a Claude. Un error de
 * la API sí se propaga — lib/agents/video-editor.ts decide (hoy: sigue con el fallback por nombre de
 * archivo y sin colores de tono).
 */
export async function analyzeContent(
  segments: WhisperSegment[],
  catalogModels: string[],
  usage?: ClaudeUsage[],
): Promise<ContentSegmentResult[]> {
  if (segments.length === 0 || catalogModels.length === 0) return [];

  const numbered = segments.map((s, i) => `${i}: "${s.text.trim()}"`).join("\n");
  const prompt =
    `Transcripción de un reel de BNB Store (reventa de celulares), oración por oración:\n\n${numbered}\n\n` +
    `Catálogo de modelos con foto disponible (usá EXACTAMENTE estos strings en "product_models" para los que una oración ` +
    `mencione; si menciona un modelo que no está en esta lista, NO lo pongas en "product_models", pero sí anotalo en ` +
    `"all_mentioned_models" con el nombre completo tal como se entiende del habla, ej. un modelo nombrado de pasada que no ` +
    `está en la lista):\n${catalogModels.join(", ")}\n\n` +
    `Para CADA oración (por su índice, en el mismo orden, sin saltarte ninguna):\n` +
    `1. "product_models": TODOS los modelos DEL CATÁLOGO que menciona esa oración (puede nombrar más de uno seguido).\n` +
    `2. "all_mentioned_models": TODOS los modelos de celular que se nombran en esa oración, estén o no en el catálogo — ` +
    `siempre un superset de "product_models".\n` +
    `3. "sentiment": positive/negative/neutral, sobre lo que se está diciendo en esa oración puntual, no una opinión general ` +
    `sobre el modelo.\n\n` +
    `REGLA ANTI-INVENCIÓN (crítica — un modelo de más en el video es peor que uno de menos): un modelo cuenta como ` +
    `"mencionado" SOLO si su número/nombre aparece literalmente en ESA oración o en la oración INMEDIATAMENTE ANTERIOR. ` +
    `Si una oración usa una referencia sin repetir el número (ej. "esos mismos modelos", "los mismos", "estos", "en versión ` +
    `Pro Max") tenés que resolverla contra los números que SÍ aparecen escritos en la oración anterior — nunca agregues un ` +
    `número o variante que no esté escrito en ninguna de las dos. Ante la duda entre inventar un modelo o dejarlo afuera, ` +
    `dejalo afuera.`;

  const result = await askJson({
    agent: "video-editor",
    role: "parser",
    system:
      "Sos un clasificador de contenido para reels de venta de celulares de un local real. " +
      "Devolvés siempre un resultado por cada índice recibido, en el mismo orden, sin inventar modelos fuera del catálogo dado.",
    prompt,
    schema: AnalysisSchema,
    usage,
    // 2000 se quedaba corto y cortaba el JSON a mitad de un string con transcripciones largas/con
    // varios modelos por oración (visto en vivo el 25-11-2026: "Unterminated string in JSON") — igual
    // síntoma y mismo arreglo que el maxTokens de caption-style.ts.
    maxTokens: 6000,
  });

  // Red de seguridad determinística además del prompt de arriba: a Claude se le puede escapar un
  // número que no esté en ningún lado del texto real (visto en vivo: tras un pedido ambiguo del
  // tipo "esos mismos modelos en versión Pro Max", una corrida devolvió "iPhone 17 Pro" sin que
  // "17" apareciera en ninguna oración del clip). Si un modelo tiene dígitos (13, 14, 15...) y esos
  // dígitos no aparecen ni en la oración actual ni en la anterior, se descarta — un modelo de más en
  // el video es peor que uno de menos.
  const digitsOf = (text: string) => new Set(text.match(/\d+/g) ?? []);
  const segmentDigits = segments.map((s) => digitsOf(s.text));

  return result.segments.map((s) => {
    const windowDigits = new Set([...(segmentDigits[s.index] ?? []), ...(segmentDigits[s.index - 1] ?? [])]);
    const hasEvidence = (model: string) => {
      const modelDigits = digitsOf(model);
      return modelDigits.size === 0 || [...modelDigits].some((d) => windowDigits.has(d));
    };
    const allMentionedModels = s.all_mentioned_models.filter(hasEvidence);
    const productModels = s.product_models.filter((m) => hasEvidence(m) && allMentionedModels.includes(m));
    return { index: s.index, productModels, allMentionedModels, sentiment: s.sentiment };
  });
}
