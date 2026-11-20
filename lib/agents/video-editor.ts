import fs from "node:fs/promises";
import type { AgentContext, AgentModule } from "@/lib/agents/runtime";
import type { ReelCaption } from "@/remotion/ReelComposition";
import { REEL_FPS } from "@/remotion/Root";
import { downloadClipToTmp, driveAvailable, listVideoClips, uploadRenderedClipToDrive } from "@/lib/video-editor/drive";
import { getActiveCatalog, matchOverlay } from "@/lib/video-editor/product-match";
import { buildCaptions, transcribeClip } from "@/lib/video-editor/captions";
import { analyzeContent } from "@/lib/video-editor/content-analysis";
import { canRenderHere, renderReel, VERCEL_BLOCKER_MESSAGE, type MoodSegmentInput, type OverlaySegmentInput } from "@/lib/video-editor/render";
import { enhanceClip } from "@/lib/video-editor/enhance";

/** Tope por corrida: el cron pasa cada pocos minutos, no hace falta (ni conviene, por tiempo de
 * función) tragarse toda la carpeta de una. Lo que quede pendiente lo agarra la corrida siguiente. */
const MAX_CLIPS_PER_RUN = 3;

interface ProcessedClip {
  fileName: string;
  status: "done" | "error";
  outputUrl: string | null;
  error: string | null;
}

interface ContentTimeline {
  captions: ReelCaption[];
  overlaySegments: OverlaySegmentInput[];
  moodSegments: MoodSegmentInput[];
}

const EMPTY_TIMELINE: ContentTimeline = { captions: [], overlaySegments: [], moodSegments: [] };

/**
 * Transcribe el clip y le pide a Claude que identifique, oración por oración, de qué modelo del
 * catálogo habla Nacho y en qué tono — así la caja de producto y el color siguen lo que se va
 * diciendo, en vez de un solo producto fijo para todo el video (eso era `matchOverlay`, que ahora
 * queda solo como fallback cuando esto no encuentra nada o falla).
 *
 * Nunca tira: cualquier error acá (Whisper sin crédito, Claude caído, lo que sea) hace que el caller
 * siga con `EMPTY_TIMELINE` — el clip se renderiza igual, solo que con el fallback por nombre de
 * archivo y sin colores de tono.
 */
async function buildContentTimeline(ctx: AgentContext, videoPath: string): Promise<ContentTimeline> {
  const transcript = await transcribeClip(videoPath);
  if (!transcript) return EMPTY_TIMELINE;

  const captions = await buildCaptions(videoPath, transcript.words, REEL_FPS);
  if (transcript.segments.length === 0) return { ...EMPTY_TIMELINE, captions };

  const catalog = await getActiveCatalog(ctx.db);
  if (catalog.length === 0) return { ...EMPTY_TIMELINE, captions };

  const analysis = await analyzeContent(
    transcript.segments,
    catalog.map((c) => c.model),
    ctx.usage,
  );

  const overlaySegments: OverlaySegmentInput[] = [];
  const moodSegments: MoodSegmentInput[] = [];
  for (const a of analysis) {
    const seg = transcript.segments[a.index];
    if (!seg) continue;

    // Una misma frase puede nombrar varios modelos seguidos ("te recomiendo el 16, el 17 Pro y el
    // 14 Pro") — se reparte la ventana de esa frase en partes iguales, una por modelo, en el orden
    // que los nombró, en vez de mostrar uno solo y perder los demás.
    const matched = a.productModels.map((m) => catalog.find((c) => c.model === m)).filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (matched.length > 0) {
      const span = (seg.end - seg.start) / matched.length;
      matched.forEach((match, i) => {
        overlaySegments.push({ startSec: seg.start + i * span, endSec: seg.start + (i + 1) * span, imageUrl: match.hero_image_url, label: match.model });
      });
    }

    if (a.sentiment !== "neutral") moodSegments.push({ startSec: seg.start, endSec: seg.end, mood: a.sentiment });
  }

  return { captions, overlaySegments, moodSegments };
}

/**
 * Video Editor: mira la carpeta de Drive "VIDEOS BNB STORE", y por cada clip nuevo (no visto en
 * video_clips todavía) lo descarga, transcribe el audio con Whisper y le pide a Claude que identifique
 * de qué modelo del catálogo habla cada oración y con qué tono (ver buildContentTimeline arriba) —
 * eso arma la ventana de producto y el color (dorado/verde/rojo) de la caja flotante, siguiendo lo
 * que realmente se dice en el video en vez de un solo producto fijo. Si no hay transcripción (sin
 * `OPENAI_API_KEY`) o no se detectó ningún modelo, cae al match viejo por nombre de archivo
 * (`matchOverlay`) para todo el clip.
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
      let enhancedPath: string | null = null;
      try {
        const overlay = await matchOverlay(ctx.db, file.name);
        if (overlay) await ctx.db.from("video_clips").update({ product_hint: overlay.hint }).eq("id", row.id);

        tmpPath = await downloadClipToTmp(file.id, file.name);
        let renderPath = tmpPath;

        // Auto-mejora tipo "Enhance" de CapCut (contraste/brillo/saturación + nitidez) antes de
        // transcribir o renderizar — si falla, se sigue con el clip original sin mejorar.
        try {
          enhancedPath = await enhanceClip(tmpPath);
          renderPath = enhancedPath;
        } catch (err) {
          ctx.log(`${file.name}: mejora de imagen falló, sigo con el clip original — ${err instanceof Error ? err.message : err}`);
        }

        if (!canRenderHere()) {
          await ctx.db
            .from("video_clips")
            .update({ status: "error", error_message: VERCEL_BLOCKER_MESSAGE, processed_at: new Date().toISOString() })
            .eq("id", row.id);
          processed.push({ fileName: file.name, status: "error", outputUrl: null, error: VERCEL_BLOCKER_MESSAGE });
          ctx.log(`${file.name}: descargado, bloqueado en el render (no corre en este entorno)`);
          continue;
        }

        let timeline = EMPTY_TIMELINE;
        try {
          timeline = await buildContentTimeline(ctx, renderPath);
        } catch (err) {
          ctx.log(`${file.name}: análisis de voz/contenido falló, sigo con el fallback por nombre de archivo — ${err instanceof Error ? err.message : err}`);
        }
        if (timeline.overlaySegments.length > 0) {
          const models = [...new Set(timeline.overlaySegments.map((s) => s.label))];
          await ctx.db.from("video_clips").update({ product_hint: models.join(", ") }).eq("id", row.id);
        }

        const rendered = await renderReel({
          videoPath: renderPath,
          overlayImageUrl: overlay?.imageUrl ?? null,
          overlayLabel: overlay?.label ?? null,
          overlaySegments: timeline.overlaySegments,
          moodSegments: timeline.moodSegments,
          captions: timeline.captions,
        });

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
        if (enhancedPath) await fs.unlink(enhancedPath).catch(() => {});
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
