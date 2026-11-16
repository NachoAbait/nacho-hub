/**
 * Actividad de los 5 proyectos de Nacho, leída desde GitHub (no del disco: NACHO Hub corre en
 * Vercel y no ve las carpetas locales). Necesita GITHUB_TOKEN con permiso de lectura sobre los
 * repos privados. Sin esa variable, devuelve todo vacío y el que llama lo nota sin romperse.
 */

export const PROJECTS = [
  { name: "NACHO Hub", repo: "NachoAbait/nacho-hub" },
  { name: "AgroScan (AgroTrack)", repo: "NachoAbait/agrotrack" },
  { name: "NexiOS", repo: "NachoAbait/resellerapp" },
  { name: "Finanzas Personales", repo: "NachoAbait/FINANZAS-PERSONALES" },
  { name: "Tikka", repo: "NachoAbait/entradas-productora" },
] as const;

export interface ProjectCommits {
  name: string;
  repo: string;
  commits: string[];
}

/** Mensajes de commit (primera línea) de cada proyecto desde `sinceIso`, en la rama default. */
export async function fetchProjectActivity(sinceIso: string): Promise<ProjectCommits[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return PROJECTS.map((p) => ({ ...p, commits: [] }));

  return Promise.all(
    PROJECTS.map(async (p): Promise<ProjectCommits> => {
      try {
        const res = await fetch(`https://api.github.com/repos/${p.repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
        });
        if (!res.ok) return { ...p, commits: [] };
        const data = (await res.json()) as Array<{ commit: { message: string } }>;
        return { ...p, commits: data.map((d) => d.commit.message.split("\n")[0]) };
      } catch {
        return { ...p, commits: [] };
      }
    }),
  );
}
