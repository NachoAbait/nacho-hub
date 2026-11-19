import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { VIDEO_EDITOR_TMP_DIR } from "@/lib/video-editor/render";

/**
 * Acceso a la carpeta de Google Drive "VIDEOS BNB STORE" donde Nacho sube los clips crudos.
 * Service account dedicada (nacho-hub-editor@drive-nacho-hub.iam.gserviceaccount.com), con permiso
 * de Editor SOLO sobre esta carpeta — por eso el scope de escritura (`drive`) es seguro, no puede
 * tocar nada fuera de ella. La credencial completa viaja en una sola variable de entorno en base64
 * (Vercel no banca bien un JSON multilínea con comillas en una env var plana).
 */
// OJO: termina en "a". El ID sin esa letra (como quedó anotado en una versión anterior de este
// archivo) apunta a nada: Drive no tira error por un parent inexistente en `in parents`, devuelve
// lista vacía en silencio — así que con el ID viejo el agente corría "bien" pero nunca encontraba
// ningún clip. Verificado contra la carpeta real (bnbimport.dolores@gmail.com) el 19-11-2026.
export const WATCHED_FOLDER_ID = "1BRWfRmgyYjw8-dOGRevX19cDNJ6F3RJa";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const VIDEO_MIME_PREFIX = "video/";
const LISTO_FOLDER_NAME = "Listo";

function decodeServiceAccount(): { client_email: string; private_key: string } | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    if (!json.client_email || !json.private_key) return null;
    return json;
  } catch {
    return null;
  }
}

export function driveAvailable(): boolean {
  return decodeServiceAccount() !== null;
}

let cachedClient: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (cachedClient) return cachedClient;
  const creds = decodeServiceAccount();
  if (!creds) throw new Error("Falta (o está mal formada) GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: DRIVE_SCOPES });
  cachedClient = google.drive({ version: "v3", auth });
  return cachedClient;
}

export interface DriveVideoFile {
  id: string;
  name: string;
  mimeType: string;
}

/** Todos los videos de la carpeta vigilada (sin filtrar por ya procesados — eso lo hace el agente contra video_clips). */
export async function listVideoClips(): Promise<DriveVideoFile[]> {
  const drive = getDrive();
  const files: DriveVideoFile[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `'${WATCHED_FOLDER_ID}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 100,
      pageToken,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name && f.mimeType?.startsWith(VIDEO_MIME_PREFIX)) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

/**
 * Descarga un clip a VIDEO_EDITOR_TMP_DIR y devuelve la ruta local. En Vercel esto queda bloqueado
 * mucho antes de llegar al render real (ver canRenderHere en render.ts), pero igual tiene que ser
 * la MISMA carpeta que bundlea renderReel como `publicDir` — si no, el render tira 404 (ver render.ts).
 */
export async function downloadClipToTmp(fileId: string, fileName: string): Promise<string> {
  const drive = getDrive();
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dest = path.join(VIDEO_EDITOR_TMP_DIR, `video-editor-${fileId}-${safeName}`);
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    (res.data as NodeJS.ReadableStream)
      .on("error", reject)
      .pipe(out)
      .on("finish", resolve)
      .on("error", reject);
  });
  return dest;
}

let listoFolderIdCache: string | null = null;

async function ensureListoFolder(): Promise<string> {
  if (listoFolderIdCache) return listoFolderIdCache;
  const drive = getDrive();
  const { data } = await drive.files.list({
    q: `'${WATCHED_FOLDER_ID}' in parents and name = '${LISTO_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
  });
  const existingId = data.files?.[0]?.id;
  if (existingId) {
    listoFolderIdCache = existingId;
    return existingId;
  }
  const created = await drive.files.create({
    requestBody: { name: LISTO_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", parents: [WATCHED_FOLDER_ID] },
    fields: "id",
  });
  if (!created.data.id) throw new Error("No pude crear la carpeta 'Listo' en Drive");
  listoFolderIdCache = created.data.id;
  return listoFolderIdCache;
}

/**
 * Sube el render terminado a una subcarpeta "Listo" dentro de la misma carpeta vigilada, para que
 * Nacho lo vea sin salir de Drive. No es el output oficial (ese es Supabase Storage, lo que guarda
 * video_clips.output_url) — si esto falla, no rompe la corrida del agente.
 */
export async function uploadRenderedClipToDrive(buffer: Buffer, fileName: string): Promise<string | null> {
  try {
    const drive = getDrive();
    const parent = await ensureListoFolder();
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [parent] },
      media: { mimeType: "video/mp4", body: Readable.from(buffer) },
      fields: "webViewLink",
    });
    return res.data.webViewLink ?? null;
  } catch {
    return null;
  }
}
