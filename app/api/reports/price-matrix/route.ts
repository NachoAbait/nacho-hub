import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { todayArt } from "@/lib/agents/runtime";
import { buildPriceMatrixWorkbook } from "@/lib/reports/price-matrix";

export const maxDuration = 30;

/**
 * GET /api/reports/price-matrix?date=YYYY-MM-DD (opcional, default hoy ART)
 * Descarga la comparativa de precios del día: productos x proveedores, igual a lo que compara
 * Martín, con el más barato de cada fila resaltado. Sin auth especial: el resto del hub tampoco
 * la tiene (es una herramienta de uso personal, no hay login).
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") || todayArt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date inválida, usá YYYY-MM-DD" }, { status: 400 });
  }

  const wb = await buildPriceMatrixWorkbook(supabaseAdmin(), date);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comparativa-${date}.xlsx"`,
    },
  });
}
