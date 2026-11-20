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
    `"all_mentioned_models" con el nombre completo tal como se entiende del habla, ej. "iPhone 13"):\n${catalogModels.join(", ")}\n\n` +
    `Para CADA oración (por su índice, en el mismo orden, sin saltarte ninguna):\n` +
    `1. "product_models": TODOS los modelos DEL CATÁLOGO que menciona esa oración (puede ser más de uno, ej. "te recomiendo ` +
    `el 16, el 17 Pro y el 14 Pro" menciona tres).\n` +
    `2. "all_mentioned_models": TODOS los modelos de celular que se nombran en esa oración, estén o no en el catálogo — ` +
    `siempre un superset de "product_models".\n` +
    `3. "sentiment": positive/negative/neutral, sobre lo que se está diciendo en esa oración puntual, no una opinión general ` +
    `sobre el modelo.`;

  const result = await askJson({
    agent: "video-editor",
    role: "parser",
    system:
      "Sos un clasificador de contenido para reels de venta de celulares de un local real. " +
      "Devolvés siempre un resultado por cada índice recibido, en el mismo orden, sin inventar modelos fuera del catálogo dado.",
    prompt,
    schema: AnalysisSchema,
    usage,
    maxTokens: 2000,
  });

  return result.segments.map((s) => ({
    index: s.index,
    productModels: s.product_models,
    allMentionedModels: s.all_mentioned_models,
    sentiment: s.sentiment,
  }));
}
