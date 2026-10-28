"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { REGISTRY } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import { ingestPriceList } from "@/lib/agents/ingest";
import {
  addSupplier as addSupplierDb,
  approvePendingSender,
  dismissPendingSender,
  listPendingSenders,
  listSuppliers,
  removeSupplier as removeSupplierDb,
  saveSupplierList,
  saveSupplierRules,
  type PendingSender,
  type Supplier,
} from "@/lib/suppliers";
import { confirmUpdate, correctUpdate, todaysUpdates, type PriceUpdateRow } from "@/lib/price-review";
import { latestReport, todayArt } from "@/lib/agents/runtime";
import { generateAllBanners } from "@/lib/designer/generate";
import { syncProductsFromNexios } from "@/lib/designer/sync";
import { isCategory } from "@/lib/types";

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
}

export async function loadPriceReaderPanel(): Promise<PriceReaderPanelData> {
  const db = supabaseAdmin();
  const [rep, updates, suppliers, pendingSenders] = await Promise.all([
    latestReport(db, "price-reader"),
    todaysUpdates(db, todayArt()),
    listSuppliers(db),
    listPendingSenders(db),
  ]);
  return {
    report: rep ? { markdown: rep.content_markdown, date: rep.date, summary: rep.summary } : null,
    updates,
    suppliers,
    pendingSenders,
  };
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

export async function confirmPriceUpdate(id: string): Promise<ActionResult> {
  try {
    await confirmUpdate(supabaseAdmin(), id);
    return { ok: true, message: "Confirmado" };
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
