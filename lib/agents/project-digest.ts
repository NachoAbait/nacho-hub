import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import { fetchProjectActivity } from "@/lib/github-activity";

const DigestSchema = z.object({
  projects: z.array(z.object({ name: z.string(), summary: z.string() })),
});

/**
 * "Qué se hizo" en cada uno de los 5 proyectos de Nacho, en criollo, a partir de los commits de
 * GitHub del período. Devuelve "" si no hubo actividad en ninguno (para no mandar una sección vacía).
 */
export async function buildProjectDigest(sinceIso: string, periodLabel: string, usage: ClaudeUsage[]): Promise<string> {
  const activity = await fetchProjectActivity(sinceIso);
  const withCommits = activity.filter((a) => a.commits.length > 0);
  if (!withCommits.length) return "";

  const digestInput = withCommits.map((a) => `### ${a.name}\n${a.commits.map((c) => `- ${c}`).join("\n")}`).join("\n\n");

  const result = await askJson({
    agent: "project-digest",
    role: "analyst",
    system:
      "Resumís para Nacho (Ignacio Abait) qué se hizo en cada uno de sus proyectos de software a partir de los " +
      "mensajes de commit de GitHub del período. Un párrafo corto por proyecto (1-2 frases), en español argentino, " +
      "sin tecnicismos de git ni nombres de archivos: contá qué cambió de verdad para el que usa la app (una " +
      "funcionalidad nueva, un arreglo, una mejora), no listes los mensajes tal cual. Si los mensajes no dejan " +
      "claro qué se hizo, decilo con una frase genérica breve en vez de inventar un detalle que no está.",
    prompt: `Actividad de ${periodLabel}:\n\n${digestInput}`,
    schema: DigestSchema,
    usage,
    maxTokens: 1200,
  });

  return result.projects.map((p) => `*${p.name}*: ${p.summary}`).join("\n");
}
