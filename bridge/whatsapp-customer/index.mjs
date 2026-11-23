// Puente de WhatsApp -> NACHO Hub, DEDICADO al bot de clientes.
// Número nuevo y separado del que usa bridge/whatsapp/ (proveedores) — ver README.md acá al lado para
// el por qué. Lee HUB_URL y CRON_SECRET de bridge/whatsapp-customer/.env o del entorno.
//
// A diferencia del puente de proveedores (que solo lee), este también MANDA: hace polling a
// /api/agents/customer-bot/outbox cada pocos segundos por respuestas del bot pendientes y las manda
// por Baileys — el hub es serverless y no tiene forma de hablarle directo a esta compu.
import { existsSync, readFileSync } from "node:fs";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "baileys";
import qrcode from "qrcode-terminal";
import qrcodePng from "qrcode";

// Mini lector de .env (sin dependencias)
if (existsSync(new URL("./.env", import.meta.url))) {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const HUB_URL = (process.env.HUB_URL ?? "https://nacho-hub.vercel.app").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("Falta CRON_SECRET. Creá bridge/whatsapp-customer/.env con HUB_URL y CRON_SECRET (ver README).");
  process.exit(1);
}
const OUTBOX_POLL_MS = Number(process.env.OUTBOX_POLL_MS ?? 4000);

const silent = { level: "silent", trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

let reconnectAttempts = 0;

function extractText(message) {
  if (!message) return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || "";
}

/** Siempre dígitos solos, nunca con sufijo @s.whatsapp.net / @lid — es lo que se guarda en la base y
 * lo que después arma el JID al mandar una respuesta (ver sendPendingReplies). */
function toBarePhone(jidOrNumber) {
  return jidOrNumber.replace(/@.*$/, "");
}

async function sendToHub(payload) {
  try {
    const res = await fetch(`${HUB_URL}/api/agents/customer-bot/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[hub] ${res.status}`, json);
  } catch (err) {
    console.error("[hub] no pude llegar al hub:", err.message);
  }
}

async function fetchOutbox() {
  try {
    const res = await fetch(`${HUB_URL}/api/agents/customer-bot/outbox`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return json.items ?? [];
  } catch (err) {
    console.error("[hub] no pude pedir la cola de salida:", err.message);
    return [];
  }
}

async function reportOutboxResult(id, status, error) {
  try {
    await fetch(`${HUB_URL}/api/agents/customer-bot/outbox`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ id, status, error }),
    });
  } catch (err) {
    console.error("[hub] no pude avisar el resultado del envío:", err.message);
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: silent,
    browser: ["NACHO Hub", "Desktop", "1.0"],
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    retryRequestDelayMs: 500,
  });

  sock.ev.on("creds.update", saveCreds);

  let outboxTimer = null;

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\nEscaneá este QR desde WhatsApp > Dispositivos vinculados > Vincular un dispositivo:\n");
      qrcode.generate(qr, { small: true });
      qrcodePng.toFile(new URL("./qr.png", import.meta.url).pathname, qr, { width: 400 }).catch(() => {});
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      console.log("Conectado a WhatsApp. Atendiendo clientes…");
      if (!outboxTimer) outboxTimer = setInterval(() => sendPendingReplies(sock), OUTBOX_POLL_MS);
    }
    if (connection === "close") {
      if (outboxTimer) {
        clearInterval(outboxTimer);
        outboxTimer = null;
      }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Se cerró la sesión desde el celular. Borrá la carpeta auth y volvé a correr npm start para escanear otro QR.");
        process.exit(1);
      }
      reconnectAttempts++;
      const delay = Math.min(3000 * 2 ** (reconnectAttempts - 1), 30_000);
      console.log(`Conexión cerrada (${code ?? "?"}). Reconectando en ${Math.round(delay / 1000)} s… (intento ${reconnectAttempts})`);
      if (reconnectAttempts >= 6) {
        console.warn(
          "⚠️  Van 6 reconexiones seguidas: puede ser la red del lugar, o la sesión quedó rota. " +
          "Si sigue así, cortá con Ctrl+C, borrá la carpeta auth y volvé a escanear el QR.",
        );
      }
      setTimeout(start, delay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid ?? "";
      if (jid === "status@broadcast") continue;
      if (jid.endsWith("@g.us")) continue; // número dedicado a clientes: sin grupos
      const body = extractText(msg.message).trim();
      if (!body) continue;

      let sender = (msg.key.senderPn ?? msg.key.participant ?? jid).toString();
      if (sender.endsWith("@lid")) {
        try {
          const resolved = await sock.signalRepository.lidMapping.getPNForLID(sender);
          if (resolved) sender = resolved;
          else continue; // sin forma de resolver a quién responderle: mejor no inventar
        } catch {
          continue;
        }
      }

      await sendToHub({
        sender: toBarePhone(sender),
        sender_name: msg.pushName ?? null,
        body,
        received_at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
      });
    }
  });
}

async function sendPendingReplies(sock) {
  const items = await fetchOutbox();
  for (const item of items) {
    try {
      await sock.sendMessage(`${toBarePhone(item.phone)}@s.whatsapp.net`, { text: item.body });
      await reportOutboxResult(item.id, "sent");
      console.log(`[wa] respondido a ${item.phone}`);
    } catch (err) {
      await reportOutboxResult(item.id, "error", err.message);
      console.error(`[wa] no pude mandarle a ${item.phone}:`, err.message);
    }
  }
}

start();
