"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { REGISTRY } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import { ingestPriceList } from "@/lib/agents/ingest";
import {
  addSupplier as addSupplierDb,
  approvePendingSender,
  correctQuote,
  dismissPendingSender,
  listPendingSenders,
  listSuppliers,
  removeSupplier as removeSupplierDb,
  saveSupplierList,
  saveSupplierRules,
  suppliersToday,
  supplierQuotesToday,
  type PendingSender,
  type Supplier,
  type SupplierQuote,
  type SupplierToday,
} from "@/lib/suppliers";
import { confirmAllUpdates, confirmUpdate, correctUpdate, todaysUpdates, type PriceUpdateRow } from "@/lib/price-review";
import { latestReport, todayArt } from "@/lib/agents/runtime";
import { generateAllBanners } from "@/lib/designer/generate";
import { syncProductsFromNexios } from "@/lib/designer/sync";
import { isCategory, type BusinessContext } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function fail(err: unknown): ActionResult {
  return { ok: false, message: err instanceof Error ? err.message : "Error desconocido" };
}

/** "Correr ahora": corre cualquier agente registrado en todos sus contextos. */
export async function runAgentNow(agentId: string): Promise<ActionResult> {
  const mod = REGISTRY[agentId];
  if (!mod) return { ok: false, message: "Este agente todavía no está programado." };
  try {
    const runs = await Promise.all(mod.contexts.map((c) => runAgent(mod, c, "manual")));
    revalidatePath("/");
    const bad = runs.find((r) => !r.ok);
    return bad ? { ok: false, message: bad.error ?? "Falló la corrida" } : { ok: true, message: runs.map((r) => r.summary).join(" · ") };
  } catch (err) {
    return fail(err);
  }
}

/** "Pegar lista a mano": misma función que el endpoint, sin pasar por HTTP. */
export async function pasteSupplierList(body: string, supplierId: string | null): Promise<ActionResult> {
  try {
    const r = await ingestPriceList({ source: "manual", body, supplier_id: supplierId || null });
    revalidatePath("/");
    if (r.ignored) return { ok: false, message: `No se procesó: ${r.reason}` };
    return r.run.ok ? { ok: true, message: r.run.summary ?? "Listo" } : { ok: false, message: r.run.error ?? "Falló" };
  } catch (err) {
    return fail(err);
  }
}

export interface PriceReaderPanelData {
  report: { markdown: string; date: string; summary: string | null } | null;
  updates: PriceUpdateRow[];
  suppliers: Supplier[];
  pendingSenders: PendingSender[];
  today: SupplierToday[];
}

export async function loadPriceReaderPanel(): Promise<PriceReaderPanelData> {
  const db = supabaseAdmin();
  const today = todayArt();
  const [rep, updates, suppliers, pendingSenders, todayStatus] = await Promise.all([
    latestReport(db, "price-reader"),
    todaysUpdates(db, today),
    listSuppliers(db),
    listPendingSenders(db),
    suppliersToday(db, today),
  ]);
  return {
    report: rep ? { markdown: rep.content_markdown, date: rep.date, summary: rep.summary } : null,
    updates,
    suppliers,
    pendingSenders,
    today: todayStatus,
  };
}

export interface AgentReportData {
  markdown: string;
  date: string;
  summary: string | null;
}

/** Último informe de cualquier agente registrado, para el panel genérico de la oficina. */
export async function loadAgentReport(agentId: string, context: BusinessContext): Promise<AgentReportData | null> {
  const rep = await latestReport(supabaseAdmin(), agentId, context);
  return rep ? { markdown: rep.content_markdown, date: rep.date, summary: rep.summary } : null;
}

/** Lo que Lucas interpretó hoy de un proveedor puntual, para revisar antes de mandarlo a Martín. */
export async function loadSupplierQuotes(supplierId: string): Promise<SupplierQuote[]> {
  return supplierQuotesToday(supabaseAdmin(), supplierId, todayArt());
}

/** Corrige una cotización puntual (antes de que Martín la compare), y Lucas lo aprende para ese proveedor. */
export async function correctSupplierQuote(quoteId: string, listedUnitPrice: number): Promise<ActionResult> {
  try {
    if (!Number.isFinite(listedUnitPrice) || listedUnitPrice <= 0) return { ok: false, message: "Precio inválido" };
    await correctQuote(supabaseAdmin(), quoteId, listedUnitPrice);
    return { ok: true, message: "Corregido" };
  } catch (err) {
    return fail(err);
  }
}

/** Suma un remitente nuevo (número mal cargado o canal) como proveedor activo. */
export async function approveSender(sender: string, name: string | null): Promise<ActionResult> {
  try {
    await approvePendingSender(supabaseAdmin(), sender, name?.trim() || null);
    return { ok: true, message: "Sumado como proveedor" };
  } catch (err) {
    return fail(err);
  }
}

/** Descarta un remitente nuevo sin sumarlo (p. ej. una consulta de cliente). */
export async function dismissSender(sender: string): Promise<ActionResult> {
  try {
    await dismissPendingSender(supabaseAdmin(), sender);
    return { ok: true, message: "Descartado" };
  } catch (err) {
    return fail(err);
  }
}

/** Suma un proveedor por vez: no toca a los demás (a diferencia de saveSuppliers). */
export async function addSupplier(phone: string, name: string): Promise<ActionResult> {
  try {
    const r = await addSupplierDb(supabaseAdmin(), phone, name.trim() || null);
    return r.ok ? { ok: true, message: "Proveedor sumado" } : { ok: false, message: r.reason };
  } catch (err) {
    return fail(err);
  }
}

/** Da de baja un proveedor puntual (conserva reglas e historial). */
export async function removeSupplier(id: string): Promise<ActionResult> {
  try {
    await removeSupplierDb(supabaseAdmin(), id);
    return { ok: true, message: "Proveedor dado de baja" };
  } catch (err) {
    return fail(err);
  }
}

export async function saveSuppliers(text: string): Promise<ActionResult> {
  try {
    const r = await saveSupplierList(supabaseAdmin(), text);
    return { ok: true, message: `${r.active} proveedores activos${r.deactivated ? `, ${r.deactivated} desactivados` : ""}` };
  } catch (err) {
    return fail(err);
  }
}

export async function saveRules(id: string, discount: string, notes: string): Promise<ActionResult> {
  try {
    const n = discount.trim() === "" ? null : Number(discount.replace(",", "."));
    await saveSupplierRules(supabaseAdmin(), id, { unit_discount_usd: n, notes });
    return { ok: true, message: "Reglas guardadas" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * "Aplicar todo lo recomendado": una sola aprobación para todo lo que Martín dejó esperando hoy.
 * Es el paso que de verdad modifica NexiOS y el hub; nada se aplica sin pasar por acá o por el OK de a uno.
 */
export async function applyAllRecommended(): Promise<ActionResult> {
  try {
    const db = supabaseAdmin();
    const r = await confirmAllUpdates(db, todayArt());
    if (r.categories.length) {
      await syncProductsFromNexios(db);
      await generateAllBanners(r.categories.filter(isCategory));
    }
    revalidatePath("/");
    return r.applied === 0
      ? { ok: true, message: "No había nada esperando" }
      : { ok: true, message: `${r.applied} aplicados, ${r.categories.length} ${r.categories.length === 1 ? "historia" : "historias"} actualizadas` };
  } catch (err) {
    return fail(err);
  }
}

/** Si todavía no estaba aplicado, el OK es lo que de verdad modifica NexiOS, el hub y la historia de esa categoría. */
export async function confirmPriceUpdate(id: string): Promise<ActionResult> {
  try {
    const db = supabaseAdmin();
    const r = await confirmUpdate(db, id);
    if (r.applied && r.category && isCategory(r.category)) {
      await syncProductsFromNexios(db);
      await generateAllBanners([r.category]);
    }
    revalidatePath("/");
    return { ok: true, message: r.applied ? "Aplicado" : "Confirmado" };
  } catch (err) {
    return fail(err);
  }
}

/** Corrige, actualiza el costo y regenera la historia de esa categoría. */
export async function correctPriceUpdate(id: string, listedUnitPrice: number): Promise<ActionResult> {
  try {
    if (!Number.isFinite(listedUnitPrice) || listedUnitPrice <= 0) return { ok: false, message: "Precio inválido" };
    const db = supabaseAdmin();
    const r = await correctUpdate(db, id, listedUnitPrice);
    if (r.category && isCategory(r.category)) {
      await syncProductsFromNexios(db);
      await generateAllBanners([r.category]);
    }
    revalidatePath("/");
    return { ok: true, message: `Costo US$ ${r.cost}${r.newPrice != null ? ` · precio US$ ${r.newPrice}` : ""}. Lo voy a recordar para este proveedor.` };
  } catch (err) {
    return fail(err);
  }
}
