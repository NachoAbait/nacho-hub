import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryKey } from "@/lib/agents/catalog-match";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

/**
 * Orden de categorías pedido para la comparativa (distinto del orden interno de CATEGORIES).
 * "Xiaomi" y otras marcas todavía no son una categoría propia: hoy esos ítems se descartan al
 * leerlos (price-reader los clasifica "other" y los salta), así que no hay nada que listar ahí
 * todavía — si Nacho empieza a vender Xiaomi, hay que sumar la categoría primero.
 */
const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

interface QuoteRow {
  supplier_id: string | null;
  category: Category;
  model: string;
  capacity: string | null;
  cost_usd: number;
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const CATEGORY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
const CHEAPEST_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBBF7D0" } };

/** Comparativa de precios del día: productos en filas (agrupados por categoría), proveedores en columnas. */
export async function buildPriceMatrixWorkbook(db: SupabaseClient, date: string): Promise<ExcelJS.Workbook> {
  const { data: quotes, error } = await db
    .from("price_quotes")
    .select("supplier_id, category, model, capacity, cost_usd")
    .eq("quote_date", date)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`price_quotes: ${error.message}`);

  const { data: suppliers } = await db.from("suppliers").select("id, name, phone").returns<{ id: string; name: string | null; phone: string }[]>();
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name ?? s.phone]));

  // Columnas: solo proveedores que cotizaron algo hoy, en el orden en que los cargó Nacho (por nombre).
  const supplierIds = [...new Set((quotes ?? []).map((q) => q.supplier_id).filter((v): v is string => !!v))].sort((a, b) =>
    (supplierName.get(a) ?? "").localeCompare(supplierName.get(b) ?? ""),
  );

  // Filas: un producto (categoría + modelo + capacidad, agrupados sin importar el orden de palabras
  // de cada proveedor) con lo que cotizó cada uno. Para el título de la fila usamos el nombre más
  // descriptivo que haya escrito algún proveedor (el más largo), no el del catálogo: matchCatalog es
  // una búsqueda difusa pensada para aplicar precios, no para elegir una etiqueta para mostrar, y
  // podía juntar bajo un mismo nombre genérico cosas que en realidad son productos distintos.
  interface Row { category: Category; label: string; sortKey: string; bySupplier: Map<string, number> }
  const rows = new Map<string, Row>();
  for (const q of quotes ?? []) {
    const key = entryKey(q.category, q.model, q.capacity);
    let row = rows.get(key);
    const label = `${q.model}${q.capacity ? ` ${q.capacity}` : ""}`;
    if (!row) {
      row = { category: q.category, label, sortKey: q.model.toLowerCase(), bySupplier: new Map() };
      rows.set(key, row);
    } else if (label.length > row.label.length) {
      row.label = label;
    }
    if (q.supplier_id) {
      const prev = row.bySupplier.get(q.supplier_id);
      if (prev == null || q.cost_usd < prev) row.bySupplier.set(q.supplier_id, q.cost_usd);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NACHO Hub · Martín (Price Analyst)";
  wb.created = new Date();
  const sheet = wb.addWorksheet(`Comparativa ${date}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });

  sheet.getColumn(1).width = 34;
  for (let i = 0; i < supplierIds.length; i++) sheet.getColumn(i + 2).width = 16;

  const header = sheet.addRow(["Producto", ...supplierIds.map((id) => supplierName.get(id) ?? id)]);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const category of CATEGORY_ORDER) {
    const inCategory = [...rows.values()].filter((r) => r.category === category).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (!inCategory.length) continue;

    const title = sheet.addRow([CATEGORY_LABEL[category]]);
    sheet.mergeCells(title.number, 1, title.number, supplierIds.length + 1);
    title.getCell(1).font = { bold: true };
    title.getCell(1).fill = CATEGORY_FILL;

    for (const row of inCategory) {
      const cheapest = row.bySupplier.size ? Math.min(...row.bySupplier.values()) : null;
      const excelRow = sheet.addRow([row.label, ...supplierIds.map((id) => row.bySupplier.get(id) ?? null)]);
      excelRow.getCell(1).font = { bold: true };
      for (let i = 0; i < supplierIds.length; i++) {
        const cell = excelRow.getCell(i + 2);
        const value = row.bySupplier.get(supplierIds[i]);
        if (value == null) continue;
        cell.numFmt = '"US$ "#,##0';
        if (cheapest != null && value === cheapest) {
          cell.fill = CHEAPEST_FILL;
          cell.font = { bold: true };
        }
      }
    }
  }

  return wb;
}
