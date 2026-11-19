import fs from "node:fs/promises";
import type { AgentModule } from "@/lib/agents/runtime";
import { downloadClipToTmp, driveAvailable, listVideoClips, uploadRenderedClipToDrive } from "@/lib/video-editor/drive";
import { matchOverlay } from "@/lib/video-editor/product-match";
import { canRenderHere, renderReel, VERCEL_BLOCKER_MESSAGE } from "@/lib/video-editor/render";

/** Tope por corrida: el cron pasa cada pocos minutos, no hace falta (ni conviene, por tiempo de
 * función) tragarse toda la carpeta de una. Lo que quede pendiente lo agarra la corrida siguiente. */
const MAX_CLIPS_PER_RUN = 3;

interface ProcessedClip {
  fileName: string;
  status: "done" | "error";
  outputUrl: string | null;
  error: string | null;
}

/**
 * Video Editor: mira la carpeta de Drive "VIDEOS BNB STORE", y por cada clip nuevo (no visto en
 * video_clips todavía) lo descarga, le matchea un producto por el nombre del archivo y lo renderiza
 * con el overlay "spotlight" (ver remotion/ReelComposition.tsx). Sin transcripción todavía (fase 2,
 * falta billing de OpenAI) y sin detectar el momento real en que el producto aparece en pantalla
 * (fase 2 también) — la caja se muestra desde el arranque, ver render.ts.
 *
 * Nunca tira: cada clip que falla queda con status 'error' y su propio mensaje, el resto sigue.
 */
export const videoEditor: AgentModule = {
  id: "video-editor",
  contexts: ["BNB"],
  requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"],
  async run(ctx) {
    if (!driveAvailable()) {
      return {
        markdown: "Sin credencial de Google Drive (`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`): no puedo revisar la carpeta todavía.",
        summary: "sin credencial de Drive",
        data: { total: 0, nuevos: 0, processed: [] },
      };
    }

    const { data: already } = await ctx.db.from("video_clips").select("drive_file_id").returns<{ drive_file_id: string }[]>();
    const seen = new Set((already ?? []).map((r) => r.drive_file_id));

    let files;
    try {
      files = await listVideoClips();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(`ERROR listando Drive: ${message}`);
      return { markdown: `No pude leer la carpeta de Drive: ${message}`, summary: "error leyendo Drive", data: { total: 0, nuevos: 0, processed: [] } };
    }

    const fresh = files.filter((f) => !seen.has(f.id)).slice(0, MAX_CLIPS_PER_RUN);
    ctx.log(`${files.length} clips en la carpeta, ${fresh.length} nuevos esta corrida`);

    const processed: ProcessedClip[] = [];

    for (const file of fresh) {
      const { data: row } = await ctx.db
        .from("video_clips")
        .insert({ drive_file_id: file.id, drive_file_name: file.name, status: "processing" })
        .select("id")
        .single<{ id: string }>();
      if (!row) continue;

      let tmpPath: string | null = null;
      try {
        const overlay = await matchOverlay(ctx.db, file.name);
        if (overlay) await ctx.db.from("video_clips").update({ product_hint: overlay.hint }).eq("id", row.id);

        tmpPath = await downloadClipToTmp(file.id, file.name);

        if (!canRenderHere()) {
          await ctx.db
            .from("video_clips")
            .update({ status: "error", error_message: VERCEL_BLOCKER_MESSAGE, processed_at: new Date().toISOString() })
            .eq("id", row.id);
          processed.push({ fileName: file.name, status: "error", outputUrl: null, error: VERCEL_BLOCKER_MESSAGE });
          ctx.log(`${file.name}: descargado, bloqueado en el render (no corre en este entorno)`);
          continue;
        }

        const rendered = await renderReel({ videoPath: tmpPath, overlayImageUrl: overlay?.imageUrl ?? null, overlayLabel: overlay?.label ?? null });

        const storagePath = `edited/${file.id}.mp4`;
        const { error: uploadErr } = await ctx.db.storage.from("clips").upload(storagePath, rendered, { contentType: "video/mp4", upsert: true });
        if (uploadErr) throw new Error(`Error subiendo a Storage: ${uploadErr.message}`);
        const outputUrl = ctx.db.storage.from("clips").getPublicUrl(storagePath).data.publicUrl;

        // No crítico: si falla, el output real (Supabase Storage) ya quedó guardado igual.
        void uploadRenderedClipToDrive(rendered, file.name);

        await ctx.db.from("video_clips").update({ status: "done", output_url: outputUrl, processed_at: new Date().toISOString() }).eq("id", row.id);
        processed.push({ fileName: file.name, status: "done", outputUrl, error: null });
        ctx.log(`${file.name}: render listo → ${outputUrl}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.db.from("video_clips").update({ status: "error", error_message: message, processed_at: new Date().toISOString() }).eq("id", row.id);
        processed.push({ fileName: file.name, status: "error", outputUrl: null, error: message });
        ctx.log(`ERROR en ${file.name}: ${message}`);
      } finally {
        if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
      }
    }

    const done = processed.filter((p) => p.status === "done").length;
    const errored = processed.filter((p) => p.status === "error").length;

    const lines = [`# Video Editor`, "", `${files.length} clips en la carpeta de Drive, ${fresh.length} nuevos esta corrida.`];
    for (const p of processed) lines.push(`- **${p.fileName}**: ${p.status}${p.error ? ` — ${p.error}` : ""}`);
    if (fresh.length === 0) lines.push("", "Nada nuevo para editar.");

    return {
      markdown: lines.join("\n"),
      summary: fresh.length === 0 ? "sin clips nuevos" : `${done} render(es) listo(s), ${errored} con error`,
      data: { total: files.length, nuevos: fresh.length, processed },
    };
  },
};
