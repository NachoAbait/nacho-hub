import { NextResponse } from "next/server";
import { DesignerError, generateBanner } from "@/lib/designer/generate";
import { isCategory } from "@/lib/types";

// Playwright + fuentes + upload: en Vercel Hobby el tope es 60 s.
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST /api/designer/generate
 * Headers: Authorization: Bearer <CRON_SECRET>
 * Body: { "category": "iphone" }
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 });
  }

  const category = (body as { category?: unknown })?.category;
  if (!isCategory(category)) {
    return NextResponse.json({ error: "category inválida" }, { status: 400 });
  }

  try {
    const banner = await generateBanner(category);
    return NextResponse.json({ ok: true, banner });
  } catch (err) {
    const status = err instanceof DesignerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[designer/generate]", category, message);
    return NextResponse.json({ error: message }, { status });
  }
}
