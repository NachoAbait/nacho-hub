// Puente de WhatsApp -> NACHO Hub.
// Lee HUB_URL y CRON_SECRET (y opcionalmente SEND_BROADCAST_FLAG) de bridge/whatsapp/.env o del entorno.
// El FILTRO real de proveedores vive en el hub: solo se procesan los números que Nacho cargó en el panel
// (Price Reader > Proveedores). Cualquier otro remitente recibe { ignored: true } y no se guarda nada.
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

/** Cuántos minutos puede tener un mensaje para que el bot todavía le conteste.
 *
 * Al reconectar, WhatsApp le entrega al puente TODO lo que llegó mientras
 * estuvo caído, y Baileys lo emite como si fuera nuevo. El 27-11-2026 el
 * puente estuvo 24 horas apagado y al volver el bot contestó conversaciones
 * de ayer que Nacho ya había respondido a mano: el cliente recibió dos
 * respuestas distintas con un día de diferencia.
 *
 * El filtro va SOLO en el camino del bot de clientes. Las listas de
 * proveedores se siguen procesando aunque lleguen viejas: ahí no hay nadie
 * esperando del otro lado y perder una lista de precios es peor. */
const MINUTOS_FRESCURA = Number(process.env.MINUTOS_FRESCURA ?? 10);
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("Falta CRON_SECRET. Creá bridge/whatsapp/.env con HUB_URL y CRON_SECRET (ver README).");
  process.exit(1);
}
const OUTBOX_POLL_MS = Number(process.env.OUTBOX_POLL_MS ?? 4000);

const silent = { level: "silent", trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

/** Cuántas veces se cayó seguido sin llegar a abrir bien: resetea en cada "open". */
let reconnectAttempts = 0;

function extractText(message) {
  if (!message) return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || "";
}

/** Siempre dígitos solos, nunca con sufijo @s.whatsapp.net / @lid.
 *
 * También corta en ":" — WhatsApp numera los dispositivos de una cuenta y a
 * veces el número llega como "5492245509272:0". Sin esto, el mismo cliente
 * abría una conversación nueva por cada dispositivo desde el que escribía: el
 * bot perdía el hilo a mitad de una venta y a Nacho le llegaba el aviso con
 * un número que no se puede copiar ni pegar. Pasó el 27-11-2026 con 2 de las
 * 4 conversaciones del día. */
function toBarePhone(jidOrNumber) {
  return jidOrNumber.replace(/[:@].*$/, "");
}

/** true si el hub lo procesó como proveedor (lista de precios). false si lo ignoró (no es proveedor
 * cargado) — en ese caso, si no es grupo, se lo pasa al bot de clientes. */
async function sendToHub(payload) {
  try {
    const res = await fetch(`${HUB_URL}/api/agents/price-reader/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[hub] ${res.status}`, json);
      return true; // error real: no lo tratamos como "no es proveedor"
    }
    if (json.ignored) return false;
    console.log(`[hub] lista de ${json.supplier ?? payload.sender}: ${json.run?.summary ?? json.run?.error ?? "procesada"}`);
    return true;
  } catch (err) {
    console.error("[hub] no pude llegar al hub:", err.message);
    return true;
  }
}

async function sendToCustomerBot(payload) {
  try {
    const res = await fetch(`${HUB_URL}/api/agents/customer-bot/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[hub] (bot clientes) ${res.status}`, json);
  } catch (err) {
    console.error("[hub] (bot clientes) no pude llegar al hub:", err.message);
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
    console.error("[hub] no pude pedir la cola de respuestas:", err.message);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay entre mensajes seguidos al mismo número: aunque se manden en orden, sin esto a veces
 * un mensaje corto le llega al cliente antes que uno más largo mandado justo antes (ej. una lista). */
const BETWEEN_MESSAGES_DELAY_MS = 1500;

async function sendPendingReplies(sock) {
  const items = await fetchOutbox();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      await sock.sendMessage(`${toBarePhone(item.phone)}@s.whatsapp.net`, { text: item.body });
      await reportOutboxResult(item.id, "sent");
      console.log(`[wa] bot de clientes respondió a ${item.phone}`);
    } catch (err) {
      await reportOutboxResult(item.id, "error", err.message);
      console.error(`[wa] no pude mandarle a ${item.phone}:`, err.message);
    }
    const nextIsSamePhone = items[i + 1]?.phone === item.phone;
    if (nextIsSamePhone) await sleep(BETWEEN_MESSAGES_DELAY_MS);
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
    // Red casera + wifi: valores más generosos que el default para no entrar en bucle de reconexión (408).
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
      console.log("Conectado a WhatsApp. Esperando listas de proveedores y consultas de clientes…");
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
      // Backoff: si se cae seguido (red inestable), espaciar los reintentos en vez de machacar cada 3 s,
      // que puede hacer que el servidor siga cortando la conexión.
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
      // DIAGNÓSTICO TEMPORAL: si Nacho reenvía un mensaje de un Canal a otro chat (ej. a sí mismo),
      // WhatsApp guarda acá el canal de origen — aunque el canal en sí nunca llegue en vivo. Esto
      // va ANTES del filtro de fromMe porque un reenvío a uno mismo llega marcado fromMe=true.
      for (const part of Object.values(msg.message ?? {})) {
        const info = part?.contextInfo?.forwardedNewsletterMessageInfo;
        if (info) console.log(`[debug] CANAL: jid=${info.newsletterJid} nombre="${info.newsletterName}"`);
      }
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid ?? "";
      if (jid === "status@broadcast") continue; // estados: nunca
      // Las Comunidades de WhatsApp son grupos por dentro (jid termina en @g.us): NO se descartan más.
      // Quien manda el mensaje dentro del grupo/comunidad siempre viaja en participant/participantPn.
      const isGroup = jid.endsWith("@g.us");
      const body = extractText(msg.message).trim();
      // DIAGNÓSTICO TEMPORAL: ver qué llega de grupos/comunidades (ej. el anuncio de Kondor), para
      // entender si el mensaje ni siquiera llega al puente o si llega pero sin texto extraíble.
      if (isGroup) {
        console.log(
          `[debug] GRUPO/COMUNIDAD jid=${jid} participant=${msg.key.participant ?? ""} senderPn=${msg.key.senderPn ?? ""} ` +
          `participantPn=${msg.key.participantPn ?? ""} msgKeys=${Object.keys(msg.message ?? {}).join(",")} body="${body.slice(0, 60)}"`,
        );
      }
      if (!body) continue;
      // Chats 1 a 1 con addressingMode "lid": WhatsApp identifica el chat con un id anónimo (el jid
      // termina en @lid), pero Baileys ya nos manda el número real aparte, en remoteJidAlt — ahí no
      // hace falta resolver nada. OJO: en estos casos "participant" viene como "" (string vacío, no
      // undefined), así que "??" no cae al jid — por eso se chequea remoteJidAlt ANTES de armar sender.
      let sender;
      if (!isGroup && typeof msg.key.remoteJidAlt === "string" && msg.key.remoteJidAlt.endsWith("@s.whatsapp.net")) {
        sender = msg.key.remoteJidAlt;
      } else {
        // En chats de grupo/comunidad, el número real viene en senderPn / participantPn.
        sender = (msg.key.senderPn || msg.key.participantPn || msg.key.participant || jid).toString();
      }
      // Comunidades/canales: WhatsApp manda un @lid (id anónimo) en vez del número real. Baileys guarda
      // el mapeo lid->número si ya lo vio antes; si no, sigue sin resolver (no hay forma de "preguntarle"
      // a WhatsApp el número de alguien que nunca escribió directo).
      if (sender.endsWith("@lid")) {
        try {
          const resolved = await sock.signalRepository.lidMapping.getPNForLID(sender);
          if (resolved) {
            console.log(`[debug] LID resuelto: ${sender} -> ${resolved}`);
            sender = resolved;
          } else {
            console.log(`[debug] LID sin resolver todavía: ${sender}`);
          }
        } catch (err) {
          console.log(`[debug] error resolviendo LID ${sender}: ${err.message}`);
        }
      }
      const isSupplier = await sendToHub({
        sender,
        sender_name: msg.pushName ?? null,
        body,
        received_at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        source: "whatsapp",
        // Señal extra, nunca filtro único: el hub decide por la lista de proveedores.
        broadcast: msg.broadcast === true,
        group: isGroup,
      });
      // No es proveedor cargado ni hubo error: si es un chat 1 a 1, se lo pasamos al bot de clientes.
      if (!isSupplier && !isGroup) {
        // Viejo = el puente estuvo caído y esto ya lo contestó Nacho a mano.
        const minutos = (Date.now() - (Number(msg.messageTimestamp) || 0) * 1000) / 60000;
        if (minutos > MINUTOS_FRESCURA) {
          console.log(`[wa] NO contesto: el mensaje tiene ${Math.round(minutos)} min (tope ${MINUTOS_FRESCURA}). De ${toBarePhone(sender)}`);
          continue;
        }
        const barePhone = toBarePhone(sender);
        if (!barePhone) {
          // DIAGNÓSTICO TEMPORAL: no pudimos sacar un número real de este mensaje 1 a 1 (sender vacío
          // o LID sin resolver). Volcamos la key completa para entender qué campo trae el número.
          console.log(`[debug] sin número válido para responder. jid=${jid} key=${JSON.stringify(msg.key)}`);
          continue;
        }
        await sendToCustomerBot({
          sender: barePhone,
          sender_name: msg.pushName ?? null,
          body,
        });
      }
    }
  });
}

start();
