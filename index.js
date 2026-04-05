require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const QRCode = require("qrcode-terminal");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const logger = pino({ level: "silent" });

const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";
const DATA_DIR = process.env.DATA_DIR || "./data";
const MEDIA_DIR = process.env.MEDIA_DIR || "./media";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || ".";
const TIMEZONE = process.env.TIMEZONE || "Asia/Jakarta";
const TZ_LABEL = process.env.TZ_LABEL || "WIB";

let sock = null;
let isReady = false;
let reconnecting = false;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureFiles() {
  ensureDir(AUTH_DIR);
  ensureDir(DATA_DIR);
  ensureDir(MEDIA_DIR);

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          targetGroupJid: "",
          slots: {},
          enabled: false
        },
        null,
        2
      )
    );
  }
}

function loadConfig() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function getTimeParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
    seconds: `${map.hour}:${map.minute}:${map.second}`
  };
}

function todayDate() {
  return getTimeParts().date;
}

function nowTime() {
  return getTimeParts().time;
}

function nowSeconds() {
  return getTimeParts().seconds;
}

async function reply(remoteJid, text, quoted) {
  return sock.sendMessage(remoteJid, { text }, { quoted });
}

async function sendSlot(timeKey) {
  const config = loadConfig();
  const slot = config.slots[timeKey];

  if (!slot) throw new Error(`Slot ${timeKey} tidak ditemukan`);
  if (!config.targetGroupJid) throw new Error("Group belum di-set. Pakai .setgrup");

  let sentPhoto = false;

  for (let i = 0; i < (slot.photos || []).length; i++) {
    const photo = slot.photos[i];
    if (!fs.existsSync(photo.path)) continue;

    await sock.sendMessage(config.targetGroupJid, {
      image: { url: photo.path },
      caption: i === 0 ? (slot.text || "") : ""
    });

    sentPhoto = true;
  }

  if (!sentPhoto && slot.text) {
    await sock.sendMessage(config.targetGroupJid, { text: slot.text });
  }

  if (!sentPhoto && !slot.text) {
    throw new Error("Slot kosong. Belum ada teks atau foto");
  }

  config.slots[timeKey].last = todayDate();
  saveConfig(config);
}

async function saveIncomingImageToSlot(message, timeKey) {
  const buffer = await downloadMediaMessage(
    message,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );

  if (!buffer) throw new Error("Gagal download gambar");

  const filename = `${Date.now()}_${timeKey.replace(":", "")}.jpg`;
  const filePath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  const config = loadConfig();
  if (!config.slots[timeKey]) {
    config.slots[timeKey] = { text: "", photos: [], last: "" };
  }

  config.slots[timeKey].photos.push({
    filename,
    path: filePath
  });

  saveConfig(config);
  return config.slots[timeKey].photos.length;
}

function getMessageText(message) {
  return (
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    ""
  ).trim();
}

async function handleCommand(message) {
  const text = getMessageText(message);
  if (!text.startsWith(COMMAND_PREFIX)) return;

  const remoteJid = message.key.remoteJid;
  const [cmd, ...rest] = text.slice(COMMAND_PREFIX.length).split(" ");
  const arg = rest.join(" ").trim();
  const config = loadConfig();

  try {
    if (cmd === "menu" || cmd === "help") {
      await reply(
        remoteJid,
        [
          "📌 *Menu Bot VPS*",
          ".setgrup <groupJid>",
          ".setjadwal <HH:MM>",
          ".setpesan <HH:MM> <teks>",
          "kirim foto dengan caption: .savefoto <HH:MM>",
          ".listjadwal",
          ".hapusjadwal <HH:MM>",
          ".clearjadwal",
          ".onjadwal",
          ".offjadwal",
          ".kirim <HH:MM>",
          ".status"
        ].join("\n"),
        message
      );
      return;
    }

    if (cmd === "status") {
      await reply(
        remoteJid,
        [
          "✅ *Status Bot VPS*",
          `Connected: ${isReady ? "Ya" : "Tidak"}`,
          `Timezone IANA: ${TIMEZONE}`,
          `Label Zona: ${TZ_LABEL}`,
          `Waktu Bot: ${todayDate()} ${nowSeconds()} ${TZ_LABEL}`,
          `Target Grup: ${config.targetGroupJid || "-"}`,
          `Scheduler: ${config.enabled ? "ON" : "OFF"}`,
          `Jumlah Slot: ${Object.keys(config.slots || {}).length}`
        ].join("\n"),
        message
      );
      return;
    }

    if (cmd === "setgrup") {
      config.targetGroupJid = arg;
      saveConfig(config);
      await reply(remoteJid, `✅ Grup diset:\n${arg}`, message);
      return;
    }

    if (cmd === "setjadwal") {
      if (!validTime(arg)) {
        await reply(remoteJid, "Format salah. Contoh: .setjadwal 08:00", message);
        return;
      }

      if (!config.slots[arg]) {
        config.slots[arg] = { text: "", photos: [], last: "" };
      }

      saveConfig(config);
      await reply(remoteJid, `✅ Jadwal dibuat: ${arg}`, message);
      return;
    }

    if (cmd === "setpesan") {
      const parts = arg.split(" ");
      const timeKey = parts.shift();
      const msg = parts.join(" ");

      if (!validTime(timeKey) || !msg) {
        await reply(remoteJid, "Format salah. Contoh: .setpesan 08:00 Selamat pagi", message);
        return;
      }

      if (!config.slots[timeKey]) {
        config.slots[timeKey] = { text: "", photos: [], last: "" };
      }

      config.slots[timeKey].text = msg;
      saveConfig(config);
      await reply(remoteJid, `✅ Pesan untuk ${timeKey} disimpan.`, message);
      return;
    }

    if (cmd === "savefoto") {
      const timeKey = arg.trim();

      if (!validTime(timeKey)) {
        await reply(remoteJid, "Kirim foto dengan caption: .savefoto 08:00", message);
        return;
      }

      if (!message.message?.imageMessage) {
        await reply(remoteJid, "Harus kirim gambar dengan caption .savefoto 08:00", message);
        return;
      }

      const total = await saveIncomingImageToSlot(message, timeKey);
      await reply(remoteJid, `✅ Foto disimpan ke slot ${timeKey}\nTotal foto: ${total}`, message);
      return;
    }

    if (cmd === "listjadwal") {
      const entries = Object.keys(config.slots || {}).sort();

      if (!entries.length) {
        await reply(remoteJid, "Belum ada jadwal.", message);
        return;
      }

      const lines = [
        "⏰ *Daftar Jadwal*",
        `Timezone IANA: ${TIMEZONE}`,
        `Label Zona: ${TZ_LABEL}`,
        `Sekarang: ${todayDate()} ${nowSeconds()} ${TZ_LABEL}`,
        ""
      ];

      for (const timeKey of entries) {
        const slot = config.slots[timeKey];
        lines.push(
          `${timeKey} | teks: ${slot.text ? "ada" : "kosong"} | foto: ${(slot.photos || []).length}`
        );
      }

      await reply(remoteJid, lines.join("\n"), message);
      return;
    }

    if (cmd === "hapusjadwal") {
      const timeKey = arg.trim();
      delete config.slots[timeKey];
      saveConfig(config);
      await reply(remoteJid, `✅ Jadwal dihapus: ${timeKey}`, message);
      return;
    }

    if (cmd === "clearjadwal") {
      config.slots = {};
      config.enabled = false;
      saveConfig(config);
      await reply(remoteJid, "✅ Semua jadwal dihapus dan scheduler dimatikan.", message);
      return;
    }

    if (cmd === "onjadwal") {
      config.enabled = true;
      saveConfig(config);
      await reply(remoteJid, `✅ Scheduler ON\nTimezone aktif: ${TIMEZONE} (${TZ_LABEL})`, message);
      return;
    }

    if (cmd === "offjadwal") {
      config.enabled = false;
      saveConfig(config);
      await reply(remoteJid, "✅ Scheduler OFF", message);
      return;
    }

    if (cmd === "kirim") {
      const timeKey = arg.trim();
      if (!validTime(timeKey)) {
        await reply(remoteJid, "Contoh: .kirim 08:00", message);
        return;
      }

      await sendSlot(timeKey);
      await reply(remoteJid, `✅ Slot ${timeKey} terkirim.`, message);
    }
  } catch (err) {
    console.error("[COMMAND ERROR]", err);
    await reply(remoteJid, `❌ Error: ${err.message}`, message);
  }
}

async function connectBot() {
  ensureFiles();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ["Ubuntu", "Chrome", "120.0.0"],
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("\n=== SCAN QR WHATSAPP ===");
      QRCode.generate(qr, { small: true });
      console.log("Scan QR di WhatsApp > Perangkat Tertaut\n");
    }

    if (connection === "open") {
      isReady = true;
      reconnecting = false;
      console.log(`READY | ${todayDate()} ${nowSeconds()} ${TZ_LABEL} | ${TIMEZONE}`);
    }

    if (connection === "close") {
      isReady = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("Connection closed. code:", statusCode);

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        console.log("Reconnect 5 detik lagi...");
        setTimeout(() => {
          connectBot().catch(console.error);
        }, 5000);
      } else if (!shouldReconnect) {
        console.log("Session logout. Hapus auth_info lalu scan ulang.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      try {
        if (!message.message) continue;
        if (!message.key.fromMe) continue;
        await handleCommand(message);
      } catch (err) {
        console.error("[UPSERT ERROR]", err);
      }
    }
  });
}

setInterval(async () => {
  try {
    if (!isReady) return;

    const config = loadConfig();
    if (!config.enabled) return;

    const currentTime = nowTime();
    const slot = config.slots[currentTime];

    if (slot && slot.last !== todayDate()) {
      try {
        await sendSlot(currentTime);
        console.log(`[AUTO] Sent slot ${currentTime} ${TZ_LABEL}`);
      } catch (err) {
        console.log("[AUTO ERROR]", err.message);
      }
    }
  } catch (err) {
    console.log("[SCHEDULER ERROR]", err.message);
  }
}, 30000);

connectBot().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
