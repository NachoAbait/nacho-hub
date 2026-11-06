"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { REGISTRY } from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import { ingestPriceList } from "@/lib/agents/ingest";
import {
  addSupplier as addSupplierDb,
  approvePendingSender,
  correctQuote,
  dismissPendingSender,
  linkPendingSenderToSupplier,
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
import { confirmAllUpdates, confirmUpdate, correctUpdate } from "@/lib/price-review";
import { loadComparisonRows, selectSupplierForProduct as selectSupplierForProductDb, type ComparisonQuote, type ComparisonRow } from "@/lib/price-comparison";
import { computeStockReport, type StockReport } from "@/lib/stock-report";
import { computeMarketReport, type MarketReport } from "@/lib/market-report";
import { getSetting, latestReport, todayArt } from "@/lib/agents/runtime";
import { generateAllBanners } from "@/lib/designer/generate";
import { syncProductsFromNexios } from "@/lib/designer/sync";
import { CATEGORY_TO_DEVICE, DEVICE_TO_CATEGORY, NEXIOS_ORG_ID, catalogModelText, fetchCatalog, nexios, normalizeCapacity, normalizeModel } from "@/lib/nexios";
import { entryKey, wordsMatch } from "@/lib/agents/catalog-match";
import { averageMargin, type PendingNewModel, type PendingVisibility } from "@/lib/agents/catalog-manager";
import { isCategory, type BusinessContext, type Category } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function fail(err: unknown): ActionResult {
  return { ok: false, message: err instanceof Error ? err.message : "Error desconocido" };
}

/**
 * Playwright puede tardar más que el límite de la página (60s). Si la regeneración de banners
 * va adentro del mismo request que el click de Nacho, un banner lento mata la función antes de que
 * la confirmación (que ya se guardó en la base) llegue a responderle al panel, y la celda se queda
 * amarilla aunque por detrás ya esté aplicado. `after()` corre esto una vez que la respuesta ya salió.
 */
function regenerateBannersAfterResponse(categories: Category[]): void {
  after(async () => {
    try {
      await generateAllBanners(categories);
    } catch {
      // Un banner que falla no debe arruinar nada: el precio ya quedó aplicado antes de esto.
    }
  });
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
  suppliers: Supplier[];
  pendingSenders: PendingSender[];
  today: SupplierToday[];
  modelHints: string[];
}

// Lucas solo lee: las recomendaciones de Martín (lo que espera tu aprobación) viven en su propio
// panel, no acá. Ver loadPriceComparison / selectSupplierForProduct.
export async function loadPriceReaderPanel(): Promise<PriceReaderPanelData> {
  const db = supabaseAdmin();
  const today = todayArt();
  const [rep, suppliers, pendingSenders, todayStatus, modelHints] = await Promise.all([
    latestReport(db, "price-reader"),
    listSuppliers(db),
    listPendingSenders(db),
    suppliersToday(db, today),
    getSetting<string[]>(db, "model_hints", []),
  ]);
  return {
    report: rep ? { markdown: rep.content_markdown, date: rep.date, summary: rep.summary } : null,
    suppliers,
    pendingSenders,
    today: todayStatus,
    modelHints,
  };
}

/**
 * "Lo que ya aprendimos": correcciones de Nacho sobre modelos concretos ("el MacBook NEO es siempre
 * A18 Pro"), una por línea. Lucas las lee en cada corrida. Guardar acá no necesita deploy.
 */
export async function saveModelHints(text: string): Promise<ActionResult> {
  try {
    const hints = text.split("\n").map((h) => h.trim()).filter(Boolean);
    await supabaseAdmin().from("hub_settings").upsert({ key: "model_hints", value: hints, updated_at: new Date().toISOString() });
    revalidatePath("/");
    return { ok: true, message: `Guardado (${hints.length} ${hints.length === 1 ? "pista" : "pistas"})` };
  } catch (err) {
    return fail(err);
  }
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

export type { ComparisonQuote, ComparisonRow };

/** El cuadro de Martín: productos x proveedores de HOY, solo de hoy (a las 00 arranca vacío de nuevo). */
export async function loadPriceComparison(): Promise<ComparisonRow[]> {
  return loadComparisonRows(supabaseAdmin(), todayArt());
}

export type { StockReport } from "@/lib/stock-report";

/** El cuadro visual de Julieta: siempre en vivo contra NexiOS, no espera a la próxima corrida programada. */
export async function loadStockReport(): Promise<StockReport> {
  return computeStockReport();
}

export type { MarketReport } from "@/lib/market-report";

/** El cuadro visual de Tomás: dólar + noticias, siempre en vivo. */
export async function loadMarketReport(context: BusinessContext): Promise<MarketReport> {
  return computeMarketReport(context);
}

export interface ChiefBriefData {
  date: string;
  brief: { summary: string; actions: { title: string; why: string; time: string }[]; alerts: string[] } | null;
  reported: string[];
  missing: string[];
}

/** El brief de Ernesto, ya estructurado (lo arma en su última corrida, no en vivo). */
export async function loadChiefBrief(context: BusinessContext): Promise<ChiefBriefData | null> {
  const rep = await latestReport(supabaseAdmin(), "chief-of-staff", context);
  if (!rep) return null;
  const raw = (rep.raw_data_json ?? {}) as Partial<ChiefBriefData>;
  return { date: rep.date, brief: raw.brief ?? null, reported: raw.reported ?? [], missing: raw.missing ?? [] };
}

export interface ContentIdea { format: string; hook: string; steps: string[]; cta: string; needs: string }

/** Las 3 ideas de Agustina, ya estructuradas (de su última corrida). */
export async function loadContentIdeas(context: BusinessContext): Promise<{ date: string; ideas: ContentIdea[] } | null> {
  const rep = await latestReport(supabaseAdmin(), "content-creator", context);
  if (!rep) return null;
  const raw = (rep.raw_data_json ?? {}) as { ideas?: ContentIdea[] };
  return { date: rep.date, ideas: raw.ideas ?? [] };
}

export interface CaptionVariant { label: "corta" | "completa"; text: string; hashtags: string[] }
export interface CaptionSetData { title: string; variants: CaptionVariant[] }

/** Los captions de Facundo, ya estructurados (de su última corrida). */
export async function loadCaptionSets(context: BusinessContext): Promise<{ date: string; sets: CaptionSetData[] } | null> {
  const rep = await latestReport(supabaseAdmin(), "copy-writer", context);
  if (!rep) return null;
  const raw = (rep.raw_data_json ?? {}) as { sets?: CaptionSetData[] };
  return { date: rep.date, sets: raw.sets ?? [] };
}

export interface Highlight { label: string; value: string }

/** Los datos sueltos (dólar, BTC, Fed...) que Mateo sacó de su propio informe, más el informe completo. */
export async function loadGlobalHighlights(): Promise<{ date: string; highlights: Highlight[]; markdown: string } | null> {
  const rep = await latestReport(supabaseAdmin(), "global-analyst", "GLOBAL");
  if (!rep) return null;
  const raw = (rep.raw_data_json ?? {}) as { highlights?: Highlight[] };
  return { date: rep.date, highlights: raw.highlights ?? [], markdown: rep.content_markdown };
}

export interface CompetitorPrice { competitor: string; item: string; price: string }

/** Los precios comparables que Sofía sacó de su propio informe, más el informe completo. */
export async function loadCompetitorPrices(context: BusinessContext): Promise<{ date: string; prices: CompetitorPrice[]; markdown: string } | null> {
  const rep = await latestReport(supabaseAdmin(), "competitor-scraper", context);
  if (!rep) return null;
  const raw = (rep.raw_data_json ?? {}) as { prices?: CompetitorPrice[] };
  return { date: rep.date, prices: raw.prices ?? [], markdown: rep.content_markdown };
}

/** Nacho elige a mano qué proveedor gana para este producto, aunque no sea el más barato. Aplica al toque, como "Corregir". */
export async function selectSupplierForProduct(updateId: string, quote: ComparisonQuote): Promise<ActionResult> {
  try {
    await selectSupplierForProductDb(supabaseAdmin(), updateId, quote);
    revalidatePath("/");
    return { ok: true, message: `Aplicado: ${quote.supplierName} US$ ${quote.cost}` };
  } catch (err) {
    return fail(err);
  }
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

/** Vincula un remitente nuevo (canal, comunidad o número alternativo) a un proveedor que ya tenías cargado. */
export async function linkSender(sender: string, supplierId: string): Promise<ActionResult> {
  try {
    await linkPendingSenderToSupplier(supabaseAdmin(), sender, supplierId);
    return { ok: true, message: "Vinculado al proveedor" };
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
      regenerateBannersAfterResponse(r.categories.filter(isCategory));
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
      regenerateBannersAfterResponse([r.category]);
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
      regenerateBannersAfterResponse([r.category]);
    }
    revalidatePath("/");
    return { ok: true, message: `Costo US$ ${r.cost}${r.newPrice != null ? ` · precio US$ ${r.newPrice}` : ""}. Lo voy a recordar para este proveedor.` };
  } catch (err) {
    return fail(err);
  }
}

export interface PendingPriceUpdate {
  id: string;
  category: Category;
  model: string;
  capacity: string | null;
  previousCost: number | null;
  newCost: number;
  supplierName: string | null;
  /** Ya lo confirmaste hoy: el panel lo muestra en verde en vez de sacarlo de la lista. */
  confirmed: boolean;
}

export interface CatalogManagerData {
  date: string;
  auto: boolean;
  hidden: number;
  shown: number;
  pendingPriceUpdates: PendingPriceUpdate[];
  pendingVisibility: PendingVisibility[];
  newModels: PendingNewModel[];
}

/**
 * Los productos YA creados que Martín dejó esperando tu confirmación de costo (precio anterior ->
 * nuevo), para mostrarlos ANTES de los modelos nuevos a crear: primero lo que ya existe, al final lo
 * que falta cargar. Vivo (no del informe de Bruno) para que se vea al toque, igual que el panel de
 * Martín. También trae lo que ya confirmaste HOY (no solo lo pendiente): si no, cerrar y volver a
 * abrir el panel hacía que el ítem recién habilitado desapareciera en vez de quedar en verde.
 */
async function pendingPriceUpdatesToday(db: ReturnType<typeof supabaseAdmin>): Promise<PendingPriceUpdate[]> {
  const { data: rows } = await db
    .from("price_updates")
    .select("id, category, model, capacity, previous_cost_usd, detected_cost_usd, supplier_id, review_status")
    .eq("status", "detected")
    .in("review_status", ["pending", "confirmed", "corrected"])
    .gte("created_at", `${todayArt()}T00:00:00-03:00`)
    .returns<{ id: string; category: Category; model: string; capacity: string | null; previous_cost_usd: number | null; detected_cost_usd: number; supplier_id: string | null; review_status: string }[]>();
  if (!rows?.length) return [];

  const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter((v): v is string => !!v))];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const { data: sup } = await db.from("suppliers").select("id, name, phone").in("id", supplierIds);
    for (const s of sup ?? []) supplierNames.set(s.id, s.name ?? s.phone);
  }

  return rows
    .map((r): PendingPriceUpdate => ({
      id: r.id, category: r.category, model: r.model, capacity: r.capacity,
      previousCost: r.previous_cost_usd == null ? null : Number(r.previous_cost_usd),
      newCost: Number(r.detected_cost_usd),
      supplierName: r.supplier_id ? supplierNames.get(r.supplier_id) ?? null : null,
      confirmed: r.review_status !== "pending",
    }))
    .sort((a, b) => `${a.category}:${a.model}`.localeCompare(`${b.category}:${b.model}`));
}

/**
 * Dos proveedores pueden cotizar el mismo modelo nuevo con distinto nivel de detalle: uno escribe
 * "NEO 13" y otro "MacBook NEO A18 Pro 13"" — mismo producto, el segundo tiene más información. Si
 * las palabras de un candidato son un subconjunto exacto de las de otro (misma categoría y
 * capacidad), son el mismo: nos quedamos con el más completo. Nunca junta dos variantes realmente
 * distintas (ninguna es subconjunto exacto de la otra), así que no corre riesgo de mezclar un M4
 * con un M5 por error.
 */
function dedupeNewModelsBySubset(rows: PendingNewModel[]): PendingNewModel[] {
  const groups = new Map<string, PendingNewModel[]>();
  for (const r of rows) {
    const k = `${r.category}|${normalizeCapacity(r.capacity)}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const kept: PendingNewModel[] = [];
  for (const list of groups.values()) {
    const tokenSets = list.map((r) => [...new Set(normalizeModel(r.model).split(/\s+/).filter(Boolean))]);
    const dropped = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = tokenSets[i], b = tokenSets[j];
        if (a.length < b.length && a.every((t) => b.some((t2) => wordsMatch(t, t2)))) { dropped.add(i); break; }
      }
    }
    list.forEach((r, i) => { if (!dropped.has(i)) kept.push(r); });
  }
  return kept;
}

/**
 * Los modelos nuevos (sin match en el catálogo) que todavía están esperando que los crees. Vivo
 * (no del informe de Bruno): si no, apenas creás uno seguía apareciendo con el botón "Crear" hasta
 * la próxima corrida de Bruno, en vez de desaparecer al toque. También trae los que ya creaste HOY
 * (review_status "confirmed" con reviewed_at de hoy): si no, cerrar y volver a abrir el panel hacía
 * que el que acabás de crear desapareciera en vez de quedar marcado en verde.
 */
async function newModelsToday(db: ReturnType<typeof supabaseAdmin>): Promise<PendingNewModel[]> {
  const [{ data: pending }, { data: doneToday }] = await Promise.all([
    db
      .from("price_updates")
      .select("id, category, model, capacity, detected_cost_usd, supplier_id")
      .eq("status", "new_model")
      .eq("review_status", "pending")
      .returns<{ id: string; category: Category; model: string; capacity: string | null; detected_cost_usd: number; supplier_id: string | null }[]>(),
    db
      .from("price_updates")
      .select("id, category, model, capacity, detected_cost_usd, supplier_id")
      .eq("status", "new_model")
      .eq("review_status", "confirmed")
      .gte("reviewed_at", `${todayArt()}T00:00:00-03:00`)
      .returns<{ id: string; category: Category; model: string; capacity: string | null; detected_cost_usd: number; supplier_id: string | null }[]>(),
  ]);
  const rows = [...(pending ?? []).map((r) => ({ ...r, confirmed: false })), ...(doneToday ?? []).map((r) => ({ ...r, confirmed: true }))];
  if (!rows.length) return [];

  const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter((v): v is string => !!v))];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const { data: sup } = await db.from("suppliers").select("id, name, phone").in("id", supplierIds);
    for (const s of sup ?? []) supplierNames.set(s.id, s.name ?? s.phone);
  }

  const catalog = (await fetchCatalog()) ?? [];
  const mapped = rows.map((r): PendingNewModel => {
    const margin = averageMargin(catalog, r.category);
    const cost = Number(r.detected_cost_usd);
    return {
      id: r.id, category: r.category, model: r.model, capacity: r.capacity, detectedCostUsd: cost,
      supplierName: r.supplier_id ? supplierNames.get(r.supplier_id) ?? null : null,
      suggestedMargin: margin, suggestedPrice: margin == null ? null : cost + margin,
      confirmed: r.confirmed,
    };
  });
  // El dedupe por subconjunto solo corre sobre lo pendiente: un ítem ya confirmado no se tiene
  // que tragar a uno pendiente (ni al revés), cada uno se decide por separado.
  const pendingOnly = dedupeNewModelsBySubset(mapped.filter((m) => !m.confirmed));
  return [...pendingOnly, ...mapped.filter((m) => m.confirmed)].sort((a, b) => `${a.category}:${a.model}`.localeCompare(`${b.category}:${b.model}`));
}

/**
 * Lo que Bruno dejó pendiente en su último informe, pero chequeado contra el estado REAL de NexiOS:
 * esa lista queda congelada hasta la próxima corrida de Bruno, así que sin esto un ítem ya aplicado
 * (clic en Habilitar/Ocultar) seguía apareciendo como pendiente — la acción se guardaba bien, pero
 * el panel mostraba siempre la foto vieja.
 */
async function reconcilePendingVisibility(rows: PendingVisibility[]): Promise<PendingVisibility[]> {
  if (!rows.length) return rows;
  const catalog = (await fetchCatalog()) ?? [];
  const visibleById = new Map(catalog.map((r) => [r.id, r.public_visible]));
  return rows.filter((r) => {
    const visible = visibleById.get(r.id);
    if (visible == null) return false;
    return r.action === "show" ? !visible : visible;
  });
}

/** El panel de Bruno: precios de productos existentes para confirmar, cambios de visibilidad, y al final los modelos nuevos para cargar. */
export async function loadCatalogManagerPanel(): Promise<CatalogManagerData> {
  const db = supabaseAdmin();
  const auto = await getSetting<boolean>(db, "catalog_manager_auto", false);
  const [pendingPriceUpdates, newModels] = await Promise.all([pendingPriceUpdatesToday(db), newModelsToday(db)]);
  const rep = await latestReport(db, "catalog-manager", "BNB");
  if (!rep) return { date: todayArt(), auto, hidden: 0, shown: 0, pendingPriceUpdates, pendingVisibility: [], newModels };
  const raw = (rep.raw_data_json ?? {}) as { hidden?: number; shown?: number; pendingVisibility?: PendingVisibility[] };
  const pendingVisibility = await reconcilePendingVisibility(raw.pendingVisibility ?? []);
  return { date: rep.date, auto, hidden: raw.hidden ?? 0, shown: raw.shown ?? 0, pendingPriceUpdates, pendingVisibility, newModels };
}

/** El switch del panel de Bruno: vos decidís cuándo pasa de confirmar uno por uno a automático. */
export async function setCatalogManagerAuto(auto: boolean): Promise<ActionResult> {
  try {
    await supabaseAdmin().from("hub_settings").upsert({ key: "catalog_manager_auto", value: auto, updated_at: new Date().toISOString() });
    revalidatePath("/");
    return { ok: true, message: auto ? "Modo automático activado" : "Modo manual activado" };
  } catch (err) {
    return fail(err);
  }
}

/** Confirmás un cambio de visibilidad (mostrar u ocultar) uno por uno: recién ahí se toca NexiOS. */
export async function applyCatalogVisibility(id: string, action: "hide" | "show"): Promise<ActionResult> {
  try {
    const nx = nexios();
    if (!nx) return { ok: false, message: "Falta la conexión con NexiOS" };
    const { error } = await nx.from("price_catalog").update({ public_visible: action === "show", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(new Error(error.message));
    revalidatePath("/");
    return { ok: true, message: action === "show" ? "Mostrado de nuevo" : "Ocultado" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Nacho confirma un modelo nuevo: se crea la fila en NexiOS (fuente real) con el margen sugerido
 * por Bruno, se sincroniza al hub y se regenera el banner de esa categoría. Como con cualquier otro
 * precio, nada se crea sin este click.
 */
export async function createCatalogProduct(updateId: string): Promise<ActionResult> {
  try {
    const db = supabaseAdmin();
    const { data: u } = await db
      .from("price_updates")
      .select("id, category, model, capacity, detected_cost_usd")
      .eq("id", updateId)
      .single<{ id: string; category: string; model: string; capacity: string | null; detected_cost_usd: number }>();
    if (!u) return { ok: false, message: "No encontré esa recomendación" };
    if (!isCategory(u.category)) return { ok: false, message: "Categoría inválida" };

    const nx = nexios();
    if (!nx) return { ok: false, message: "Falta la conexión con NexiOS" };

    const device = CATEGORY_TO_DEVICE[u.category as Category];
    const catalog = (await fetchCatalog()) ?? [];
    const margins = catalog.filter((r) => r.device_type === device && r.margin_usd != null).map((r) => r.margin_usd as number);
    const margin = margins.length ? Math.round(margins.reduce((a, b) => a + b, 0) / margins.length) : 0;
    const cost = Number(u.detected_cost_usd);
    const price = cost + margin;

    // Si ya hay otra fila del mismo modelo (misma familia, ignorando la capacidad — ej. "18 Pro"
    // 256GB y 512GB ya cargados, esto es el 1TB), usamos el MISMO texto y atributos que esa fila en
    // vez del texto que armó Lucas/Martín: si no, NexiOS guarda "iPhone 18 Pro" para el nuevo y "18
    // Pro" para los viejos, y quedan como dos productos distintos en vez de variantes del mismo.
    const familyKey = entryKey(u.category as Category, u.model, null);
    const sibling = catalog.find((r) => DEVICE_TO_CATEGORY[r.device_type] === u.category && entryKey(u.category as Category, catalogModelText(r), null) === familyKey);
    const model = sibling?.model ?? u.model;
    const attributes = sibling?.attributes ?? null;

    const { data: row, error } = await nx
      .from("price_catalog")
      .insert({
        organization_id: NEXIOS_ORG_ID, device_type: device, model, capacity: u.capacity, attributes,
        condition: "new_sealed", cost_usd: cost, margin_usd: margin, price_usd: price,
        is_active: true, public_visible: true,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !row) return fail(new Error(`No pude crear en NexiOS: ${error?.message}`));

    await db
      .from("price_updates")
      .update({ nexios_catalog_id: row.id, status: "applied", review_status: "confirmed", new_price_usd: price, applied_at: new Date().toISOString() })
      .eq("id", updateId);

    await syncProductsFromNexios(db);
    regenerateBannersAfterResponse([u.category]);
    revalidatePath("/");
    return { ok: true, message: `Creado: US$ ${cost} + margen US$ ${margin} = US$ ${price}` };
  } catch (err) {
    return fail(err);
  }
}
