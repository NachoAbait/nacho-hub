import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getAgentModule } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import type { BusinessContext } from "@/lib/types";

export const maxDuration = 120;

/**
 * POST /api/agents/[id]   (Bearer CRON_SECRET) — botón "Ejecutar ahora" del dashboard.
 * Body opcional: { "context": "BNB" | "AgroScan" | "GLOBAL" }. Sin body corre en todos los contextos del agente.
 *
 * GET /api/agents/[id]   (Bearer CRON_SECRET) — para un agente con horario propio, distinto del de
 * su tier (hoy solo Designer: ver vercel.json). Vercel Cron siempre llama por GET y sin body.
 */
async function run(request: Request, ctx: { params: Promise<{ id: string }> }, trigger: "manual" | "cron") {
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
  const runs = await Promise.all(contexts.map((c) => runAgent(mod, c, trigger)));
  return NextResponse.json({ ok: runs.every((r) => r.ok), runs });
}

export const GET = (request: Request, ctx: { params: Promise<{ id: string }> }) => run(request, ctx, "cron");
export const POST = (request: Request, ctx: { params: Promise<{ id: string }> }) => run(request, ctx, "manual");
