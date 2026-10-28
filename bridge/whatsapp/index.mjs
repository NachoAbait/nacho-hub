// Puente de WhatsApp -> NACHO Hub.
// Lee HUB_URL y CRON_SECRET (y opcionalmente SEND_BROADCAST_FLAG) de bridge/whatsapp/.env o del entorno.
// El FILTRO real de proveedores vive en el hub: solo se procesan los números que Nacho cargó en el panel
// (Price Reader > Proveedores). Cualquier otro remitente recibe { ignored: true } y no se guarda nada.
import { existsSync, readFileSync } from "node:fs";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "baileys";
import qrcode from "qrcode-terminal";

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
  console.error("Falta CRON_SECRET. Creá bridge/whatsapp/.env con HUB_URL y CRON_SECRET (ver README).");
  process.exit(1);
}

const silent = { level: "silent", trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

function extractText(message) {
  if (!message) return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || "";
}

async function sendToHub(payload) {
  try {
    const res = await fetch(`${HUB_URL}/api/agents/price-reader/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return console.error(`[hub] ${res.status}`, json);
    if (json.ignored) return; // no es un proveedor cargado: se ignora en silencio
    console.log(`[hub] lista de ${json.supplier ?? payload.sender}: ${json.run?.summary ?? json.run?.error ?? "procesada"}`);
  } catch (err) {
    console.error("[hub] no pude llegar al hub:", err.message);
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: silent, browser: ["NACHO Hub", "Desktop", "1.0"], markOnlineOnConnect: false });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\nEscaneá este QR desde WhatsApp > Dispositivos vinculados > Vincular un dispositivo:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log("Conectado a WhatsApp. Esperando listas de proveedores…");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Se cerró la sesión desde el celular. Borrá la carpeta auth y volvé a correr npm start para escanear otro QR.");
        process.exit(1);
      }
      console.log(`Conexión cerrada (${code ?? "?"}). Reconectando en 3 s…`);
      setTimeout(start, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid ?? "";
      if (jid.endsWith("@g.us") || jid === "status@broadcast") continue; // grupos y estados: nunca
      const body = extractText(msg.message).trim();
      if (!body) continue;
      // En chats con LID el número real viene en senderPn / participantPn.
      const sender = (msg.key.senderPn ?? msg.key.participantPn ?? msg.key.participant ?? jid).toString();
      await sendToHub({
        sender,
        sender_name: msg.pushName ?? null,
        body,
        received_at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        source: "whatsapp",
        // Señal extra, nunca filtro único: el hub decide por la lista de proveedores.
        broadcast: msg.broadcast === true,
      });
    }
  });
}

start();
