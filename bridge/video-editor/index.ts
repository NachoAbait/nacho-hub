// Puente de Video Editor -> corre el render de Remotion en esta máquina.
//
// Por qué existe: Remotion necesita un Chromium completo para renderizar, y eso no entra en el
// límite de 50MB de una Vercel Serverless Function (ver lib/video-editor/render.ts,
// VERCEL_BLOCKER_MESSAGE). En Vercel el agente (lib/agents/video-editor.ts) solo lista/descarga/
// matchea y deja cada clip en status 'error' con el motivo. Este puente corre EXACTAMENTE el mismo
// código (runAgent + videoEditor, sin reimplementar nada), pero en un proceso local donde
// process.env.VERCEL no existe, así que canRenderHere() da true y el render real sí se ejecuta.
//
// Mismo patrón que bridge/whatsapp/index.mjs: proceso Node persistente, log plano a stdout (quien
// lo lanza redirige a un archivo), lee credenciales de .env.local de la app principal. A diferencia
// del puente de WhatsApp (socket persistente con reconexión), este es solo polling sobre Drive: no
// hay conexión que mantener viva, así que alcanza un sleep-loop simple con setInterval, sin backoff.
//
// Corre con tsx porque importa TypeScript del hub directamente (lib/agents/video-editor.ts y todo
// lo que arrastra: lib/video-editor/*, remotion/*) para no duplicar esa lógica — ver npm script
// "bridge:video-editor" en package.json.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); // raíz del repo (bridge/video-editor -> ../..)

// Mini lector de .env, mismo patrón sin dependencias que bridge/whatsapp/index.mjs: este script no
// corre bajo `next`, que normalmente carga .env.local solo. Variables ya puestas en el entorno
// (ej. por el launcher) tienen prioridad y no se pisan.
const envPath = path.join(ROOT, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} else {
  console.warn(`[video-editor] no encontré ${envPath}: va a correr solo con lo que ya esté en el entorno.`);
}

const DEFAULT_INTERVAL_MS = 120_000; // 2 min: polling de Drive, no hace falta más seguido.
const INTERVAL_MS = Number(process.env.VIDEO_EDITOR_INTERVAL_MS ?? DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
const once = process.argv.includes("--once");

async function main() {
  // Import dinámico A PROPÓSITO: recién acá quedó armado process.env con lo de .env.local.
  const { runAgent } = await import("@/lib/agents/runtime");
  const { videoEditor } = await import("@/lib/agents/video-editor");

  if (process.env.VERCEL) {
    console.warn("[video-editor] ATENCIÓN: VERCEL está seteado en este entorno — el render se va a bloquear igual que en producción.");
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    console.warn("[video-editor] falta GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: el agente va a correr sin poder leer Drive.");
  }

  async function runOnce(): Promise<void> {
    console.log(`[video-editor] arrancando corrida — ${new Date().toISOString()}`);
    try {
      // Mismo call que hace app/api/agents/[id]/route.ts para este agente (contexts: ["BNB"]):
      // registra la corrida, guarda el informe y el costo, nunca tira.
      const outcome = await runAgent(videoEditor, "BNB", "cron");
      if (outcome.ok) {
        console.log(`[video-editor] ok · ${outcome.summary ?? "sin resumen"} · US$ ${outcome.costUsd.toFixed(4)} · ${outcome.ms} ms`);
      } else {
        console.error(`[video-editor] ERROR · ${outcome.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[video-editor] ERROR inesperado en la corrida: ${message}`);
    }
  }

  await runOnce();

  if (once) {
    console.log("[video-editor] --once: listo, cierro.");
    return;
  }

  console.log(`[video-editor] loop activo, cada ${Math.round(INTERVAL_MS / 1000)}s. Ctrl+C para salir.`);
  setInterval(() => {
    runOnce().catch((err) => console.error("[video-editor] ERROR en el loop:", err));
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[video-editor] ERROR fatal arrancando el puente:", err);
  process.exit(1);
});
