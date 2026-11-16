import { supabaseAdmin } from "@/lib/supabase";
import { todayArt } from "@/lib/agents/runtime";
import { sendWhatsAppMessage } from "@/lib/whatsapp-cloud";
import { buildProjectDigest } from "@/lib/agents/project-digest";
import type { ClaudeUsage } from "@/lib/claude";
import type { ChiefBrief } from "@/lib/agents/chief-of-staff";

const BUSINESS_CONTEXTS = ["BNB", "AgroScan"] as const;

/**
 * Después de que corre el Chief of Staff (tier "chief"), le arma a Nacho un único WhatsApp con
 * el resumen de cada negocio + qué se hizo en sus 5 proyectos de código, y se lo manda a su
 * número personal. No rompe el cron si falta NACHO_PHONE_NUMBER (todavía no configurado) o si
 * algo de esto falla: solo lo loguea.
 */
export async function sendDailyWhatsAppBrief(): Promise<void> {
  const phone = process.env.NACHO_PHONE_NUMBER;
  if (!phone) return;

  try {
    const db = supabaseAdmin();
    const today = todayArt();
    const { data: reports } = await db
      .from("agent_reports")
      .select("context, raw_data_json")
      .eq("agent_name", "chief-of-staff")
      .eq("date", today)
      .returns<{ context: string; raw_data_json: { brief?: ChiefBrief } | null }[]>();

    const businessSections = BUSINESS_CONTEXTS.map((ctxName) => {
      const summary = reports?.find((r) => r.context === ctxName)?.raw_data_json?.brief?.summary;
      return summary ? `*${ctxName}*: ${summary}` : null;
    }).filter((s): s is string => s != null);

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const usage: ClaudeUsage[] = [];
    const projectText = await buildProjectDigest(sinceIso, "hoy", usage);

    const parts: string[] = ["📋 *Resumen de hoy*"];
    if (businessSections.length) parts.push(businessSections.join("\n\n"));
    if (projectText) parts.push("🛠 *Proyectos*\n" + projectText);
    if (parts.length === 1) return; // ni negocio ni código tuvieron nada que contar hoy

    await sendWhatsAppMessage(phone, parts.join("\n\n"));
  } catch (err) {
    console.error("[daily-whatsapp-brief]", err instanceof Error ? err.message : err);
  }
}
