import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import type { WhisperWord } from "@/lib/video-editor/captions";

const EmphasisSchema = z.object({
  words: z.array(
    z.object({
      index: z.number(),
      level: z.enum(["normal", "keyword", "critical"]),
      sentiment: z.enum(["positive", "negative", "neutral"]),
    }),
  ),
});

export interface WordEmphasis {
  level: "normal" | "keyword" | "critical";
  sentiment: "positive" | "negative" | "neutral";
}

/**
 * Clasifica palabra por palabra qué tan importante es cada una para que el subtítulo anime distinto
 * según LO QUE SE DICE (pedido explícito: "no que sea todo texto plano y lo único que cambie sea el
 * color") — no según el volumen (eso ya lo hace buildCaptions aparte, acá es semántico):
 *   - "critical": la palabra que carga el peso emocional de la frase ("buenísimo", "porquería",
 *     "recomiendo", "no") — la más grande, coloreada según su propio sentimiento.
 *   - "keyword": un dato concreto (un modelo, un número, un precio) — tamaño intermedio, tipografía
 *     distinta (ver ReelComposition.tsx) para que se note el cambio en medio de la oración.
 *   - "normal": el resto (artículos, conectores) — tamaño y tipografía base.
 *
 * Nunca tira por falta de datos: con `words` vacío devuelve `[]` sin llamar a Claude. Un error de la
 * API se propaga — lib/agents/video-editor.ts decide (hoy: sigue con subtítulos planos en vez de
 * perder el render).
 */
export async function classifyWordEmphasis(words: WhisperWord[], usage?: ClaudeUsage[]): Promise<WordEmphasis[]> {
  if (words.length === 0) return [];

  const numbered = words.map((w, i) => `${i}: ${w.word.trim()}`).join(" ");
  const prompt =
    `Transcripción palabra por palabra de un reel de venta de celulares (BNB Store):\n\n${numbered}\n\n` +
    `Para CADA palabra (por su índice, en orden, sin saltarte ninguna):\n` +
    `- "level": "critical" si es la palabra que carga el peso emocional/clave de lo que se dice ahí ` +
    `(ej. "buenísimo", "porquería", "increíble", "recomiendo", "no"), "keyword" si es un dato concreto ` +
    `(un modelo de celular, un número de modelo, un precio), "normal" para el resto (artículos, conectores, verbos comunes).\n` +
    `- "sentiment": positive/negative/neutral — el tono de ESA palabra puntual, no de la frase entera.`;

  const result = await askJson({
    agent: "video-editor",
    role: "parser",
    system:
      "Clasificás énfasis palabra por palabra para subtítulos animados de reels de venta de celulares. " +
      "Devolvés siempre un resultado por cada índice recibido, en el mismo orden.",
    prompt,
    schema: EmphasisSchema,
    usage,
    maxTokens: 3000,
  });

  const byIndex = new Map(result.words.map((w) => [w.index, w]));
  return words.map((_, i) => {
    const w = byIndex.get(i);
    return { level: w?.level ?? "normal", sentiment: w?.sentiment ?? "neutral" };
  });
}
