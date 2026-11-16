import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { modulesOfTier } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import { sendDailyWhatsAppBrief } from "@/lib/agents/daily-whatsapp-brief";
import type { Tier } from "@/lib/agents";

export const maxDuration = 120;

const TIERS: Tier[] = ["readers", "analysts", "creators", "chief"];

/** Vercel Cron llama por GET con Authorization: Bearer CRON_SECRET. Corre en paralelo los agentes registrados del tier. */
async function handle(request: Request, ctx: { params: Promise<{ tier: string }> }) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { tier } = await ctx.params;
  if (!(TIERS as string[]).includes(tier)) return NextResponse.json({ error: "tier inválido" }, { status: 404 });

  const jobs = modulesOfTier(tier as Tier).flatMap((mod) => mod.contexts.map((c) => runAgent(mod, c, "cron")));
  const runs = await Promise.all(jobs);
  // El brief de WhatsApp a Nacho sale después de que el Chief termina de leer a todos los demás.
  if (tier === "chief") await sendDailyWhatsAppBrief();
  return NextResponse.json({ tier, ok: runs.every((r) => r.ok), runs });
}

export const GET = handle;
export const POST = handle;
