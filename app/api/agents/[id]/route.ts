import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getAgentModule } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import type { BusinessContext } from "@/lib/types";

export const maxDuration = 120;

/**
 * POST /api/agents/[id]   (Bearer CRON_SECRET)
 * Body opcional: { "context": "BNB" | "AgroScan" | "GLOBAL" }. Sin body corre en todos los contextos del agente.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await ctx.params;
  const mod = getAgentModule(id);
  if (!mod) return NextResponse.json({ error: `Agente "${id}" no registrado` }, { status: 404 });

  let wanted: BusinessContext | undefined;
  try {
    const b = (await request.json()) as { context?: string };
    if (b.context === "BNB" || b.context === "AgroScan" || b.context === "GLOBAL") wanted = b.context;
  } catch {
    /* sin body */
  }
  const contexts = wanted ? mod.contexts.filter((c) => c === wanted) : mod.contexts;
  const runs = await Promise.all(contexts.map((c) => runAgent(mod, c, "manual")));
  return NextResponse.json({ ok: runs.every((r) => r.ok), runs });
}
