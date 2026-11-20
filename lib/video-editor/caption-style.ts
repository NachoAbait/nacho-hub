import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import type { WhisperSegment, WhisperWord } from "@/lib/video-editor/captions";

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
 * color") — no según el volumen (eso ya lo hace buildPhrases aparte, acá es semántico):
 *   - "critical": la palabra que carga el peso real de ESA oración puntual dentro del guión completo.
 *   - "keyword": un dato concreto (un modelo, un número, un precio) que importa pero no es el pico
 *     emocional de la oración — tipografía distinta (ver ReelComposition.tsx) para que se note.
 *   - "normal": el resto — la gran mayoría de las palabras de cualquier oración.
 *
 * Pedido explícito de Nacho tras ver el resultado anterior: "siento que estás haciendo medio azaroso
 * el tema de los cambios de énfasis... necesito que interpretes el guión, que sepas para qué va
 * enfocado". La versión vieja le mandaba a Claude una lista plana de palabras sueltas, sin saber
 * dónde empezaba o terminaba cada oración ni qué rol jugaba dentro del guión — con eso, "importante"
 * no tenía con qué anclarse y el resultado variaba sin un criterio consistente. Acá se le pasa el
 * guión YA agrupado por oración real (mismas `segments` que usa content-analysis.ts) para que primero
 * entienda la intención de cada una (gancho, presentación de modelo, argumento de venta, cierre) y
 * clasifique el énfasis en función de ESE rol, no de la palabra aislada.
 *
 * Nunca tira por falta de datos: con `words` vacío devuelve `[]` sin llamar a Claude. Un error de la
 * API se propaga — lib/agents/video-editor.ts decide (hoy: sigue con subtítulos planos en vez de
 * perder el render).
 */
export async function classifyWordEmphasis(
  words: WhisperWord[],
  segments: WhisperSegment[],
  usage?: ClaudeUsage[],
): Promise<WordEmphasis[]> {
  if (words.length === 0) return [];

  let wordIdx = 0;
  const sentenceBlocks = segments.map((seg) => {
    const numbered: string[] = [];
    while (wordIdx < words.length && words[wordIdx].start < seg.end + 0.05) {
      numbered.push(`${wordIdx}:${words[wordIdx].word.trim()}`);
      wordIdx++;
    }
    return `ORACIÓN "${seg.text.trim()}" → ${numbered.join(" ")}`;
  });

  const prompt =
    `Guión completo de un reel de venta de celulares (BNB Store), dividido en oraciones reales. Para cada ` +
    `oración tenés su texto y, a continuación, sus palabras numeradas con el índice global que usan en la ` +
    `transcripción:\n\n${sentenceBlocks.join("\n\n")}\n\n` +
    `Primero entendé la intención de CADA oración dentro del guión completo — ¿es el gancho inicial? ¿presenta ` +
    `un modelo? ¿da un argumento de venta (precio, estado, calidad)? ¿es el cierre o la recomendación? — y con ` +
    `eso en claro, para CADA palabra (por su índice, en orden, sin saltarte ninguna) decidí:\n` +
    `- "level": "critical" SOLO para la palabra (como máximo una o dos por oración) que carga el peso real de ` +
    `ESA oración puntual — la que si la sacás, cambia lo que se está diciendo (una recomendación explícita, una ` +
    `advertencia, el precio cuando la oración ES sobre el precio, un adjetivo fuerte de calidad/estado). ` +
    `"keyword" para datos concretos que importan pero no son el pico emocional de esa oración (modelo, número de ` +
    `modelo, capacidad, color, un precio cuando no es el punto central de esa oración en particular). "normal" ` +
    `para el resto — la MAYORÍA de las palabras de cualquier oración tienen que quedar en "normal", esto no es ` +
    `para repartir variedad pareja ni para que cada oración tenga su cuota de palabras grandes.\n` +
    `- "sentiment": positive/negative/neutral — el tono de esa palabra puntual dentro de su oración.`;

  const result = await askJson({
    agent: "video-editor",
    role: "parser",
    system:
      "Interpretás el guión completo de un reel de venta de celulares como una historia con intención (gancho, " +
      "presentación de producto, argumento de venta, cierre) — no como una lista plana de palabras sueltas — y " +
      "clasificás el énfasis de cada palabra según el rol real que cumple en SU oración dentro de esa historia. " +
      "Devolvés siempre un resultado por cada índice recibido, en el mismo orden.",
    prompt,
    schema: EmphasisSchema,
    usage,
    maxTokens: 4000,
  });

  const byIndex = new Map(result.words.map((w) => [w.index, w]));
  return words.map((_, i) => {
    const w = byIndex.get(i);
    return { level: w?.level ?? "normal", sentiment: w?.sentiment ?? "neutral" };
  });
}
