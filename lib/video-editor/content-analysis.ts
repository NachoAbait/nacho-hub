import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import type { WhisperSegment } from "@/lib/video-editor/captions";

const AnalysisSchema = z.object({
  segments: z.array(
    z.object({
      index: z.number(),
      product_model: z.string().nullable(),
      sentiment: z.enum(["positive", "negative", "neutral"]),
    }),
  ),
});

export interface ContentSegmentResult {
  index: number;
  productModel: string | null;
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
    `Catálogo de modelos activos (usá EXACTAMENTE uno de estos strings si una oración lo menciona; si no menciona ninguno, ` +
    `o menciona un modelo que no está acá, poné null):\n${catalogModels.join(", ")}\n\n` +
    `Para CADA oración (por su índice, en el mismo orden, sin saltarte ninguna), decime qué modelo del catálogo menciona ` +
    `(o null) y con qué tono se dice eso — positive/negative/neutral — sobre lo que se está diciendo en esa oración puntual, ` +
    `no una opinión general sobre el modelo.`;

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

  return result.segments.map((s) => ({ index: s.index, productModel: s.product_model, sentiment: s.sentiment }));
}
