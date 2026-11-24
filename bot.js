require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const loadCommands = require('./lib/loadCommands');
const { cacheMessage, getCachedMessage, awayMode } = require('./lib/store');
const settingsStore = require('./commands/settings');

const commands = loadCommands();

async function isGroupAdmin(sock, groupJid, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata.participants.find((p) => p.id === userJid);
    return Boolean(participant?.admin);
  } catch {
    return false;
  }
}

/**
 * Antilink/Antistatus jaisi moderation features ke liye common handler.
 * mode: 'delete' = chup chaap delete + admin notice, 'warn' = delete + warning count (3 warnings = kick)
 */
async function enforceModeration(sock, from, senderJid, msg, feature, reasonText) {
  const mode = settingsStore.getMode(from, feature);
  try {
    // @lid senders ka participant khaali ho sakta hai, asal sender participantAlt mein hota hai
    await sock.sendMessage(from, {
      delete: {
        remoteJid: from,
        fromMe: false,
        id: msg.key.id,
        participant: msg.key.participant || msg.key.participantAlt,
      },
    });
  } catch (e) {}

  if (mode === 'delete') {
    await sock.sendMessage(from, { text: 'The message was deleted by admin.' });
    return;
  }

  if (mode === 'warn') {
    const count = settingsStore.addWarning(from, senderJid, feature);
    if (count >= 3) {
      await sock.sendMessage(from, {
        text: `🚫 @${senderJid.split('@')[0]} has been removed from the group after 3 warnings.`,
        mentions: [senderJid],
      });
      try {
        await sock.groupParticipantsUpdate(from, [senderJid], 'remove');
      } catch (e) {}
      settingsStore.resetWarning(from, senderJid, feature);
    } else {
      await sock.sendMessage(from, {
        text: `⚠️ @${senderJid.split('@')[0]} — ${reasonText} (Warning ${count}/3)`,
        mentions: [senderJid],
      });
    }
  }
}

// Key format: "number::deviceId" — isi number pe kai devices ban sakti hain
const sessions = new Map();

function sanitizeNumber(number) {
  return String(number).replace(/[^0-9]/g, '');
}

function getSock(number, deviceId) {
  const s = sessions.get(`${sanitizeNumber(number)}::${deviceId}`);
  return s ? s.sock : null;
}

function getStatus(number, deviceId) {
  const s = sessions.get(`${sanitizeNumber(number)}::${deviceId}`);
  return s ? s.status : 'disconnected';
}

function getAllSessions() {
  return Array.from(sessions.keys());
}

/**
 * Asal socket banata hai aur sab events attach karta hai.
 * requestCode: true ho to naya pairing code maanga jayega (sirf pehli baar).
 *              false ho to purani session se seedha reconnect hoga (515 restart ke baad).
 */
async function connectSocket(number, deviceId, requestCode) {
  const key = `${number}::${deviceId}`;
  const sessionPath = path.join('session', number, deviceId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  sessions.set(key, { sock: null, status: 'connecting' });

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS('Chrome'),
  });

  sessions.set(key, { sock, status: 'connecting' });

  let pairingCode = null;

  if (requestCode && !sock.authState.creds.registered) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      pairingCode = await sock.requestPairingCode(number);
    } catch (err) {
      console.error(`[${key}] Pairing code error:`, err.message);
      sessions.delete(key);
      throw err;
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[${key}] Disconnect reason:`, lastDisconnect?.error?.message, 'statusCode:', statusCode);
      console.log(`[${key}] ⚠️ Connection band ho gaya. Dobara connect ho raha hai:`, shouldReconnect);

      if (shouldReconnect) {
        sessions.set(key, { sock, status: 'disconnected' });
        // Same number, same deviceId, same session se reconnect — pairing code dobara nahi mangna
        connectSocket(number, deviceId, false).catch((err) => {
          console.error(`[${key}] Reconnect error:`, err.message);
        });
      } else {
        sessions.delete(key);
        try {
          fs.rmSync(path.join('session', number, deviceId), { recursive: true, force: true });
          console.log(`[${key}] 🗑️ Logged out — session delete ho gayi.`);
        } catch (e) {
          console.error(`[${key}] Session delete error:`, e.message);
        }
      }
    } else if (connection === 'open') {
      sessions.set(key, { sock, status: 'connected' });
      console.log(`[${key}] ✅ ${config.botName} connected ho gaya!`);

      // Connect hote hi ek info-card khud (self) ko bhejna
      try {
        const connectCard =
          '*╭━〔💫 BOT CONNECTED〕━✦*\n' +
          `*┃🕊️ CONNECTED : ${number}*\n` +
          `*┃💗 PREFIX        : ${config.prefix}*\n` +
          `*┃🛡️ MODE        : ${config.mode || 'public'}*\n` +
          '*┃✨ PLATFORM    : 🐧 Linux*\n' +
          '*┃🌸 VERSION      : 2.1.0*\n' +
          '*╰━━━━━━━━━━━╯*\n\n' +
          '*╭━〔🛠️ TIPS〕━━━✦*\n' +
          '*┃✧ TYPE .menu TO VIEW ALL*\n' +
          '*┃✧ INCLUDES FUN, GAME, STYLE*\n' +
          '*╰━━━━━━━━━━╯*\n\n' +
          '*╭━〔📞 CONTACT〕━✦*\n' +
          `*┃🌚 SUPPORT    :* ${config.ownerNumber}\n` +
          '*╰━━━━━━━━━━━╯*';
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text: connectCard });
      } catch (err) {
        console.error(`[${key}] Connect card send error:`, err.message);
      }

      if (config.channelLinks && config.channelLinks.length > 0) {
        for (const link of config.channelLinks) {
          try {
            const inviteCode = link.split('/').pop();
            const metadata = await sock.newsletterMetadata('invite', inviteCode);
            if (metadata && metadata.id) {
              await sock.newsletterFollow(metadata.id);
              console.log(`[${key}] ✅ Channel follow ho gaya: ${inviteCode}`);
            }
          } catch (err) {
            console.error(`[${key}] ⚠️ Channel follow nahi ho saka (${link}):`, err.message);
          }
        }
      }
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action, author } = update;
    try {
      // Antiaction: agar owner ke ilawa koi promote/demote kare, to wo revert kar do
      if ((action === 'promote' || action === 'demote') && settingsStore.getToggle(id, 'antiaction')) {
        const actorIsOwner = author === `${config.ownerNumber}@s.whatsapp.net`;
        if (!actorIsOwner) {
          try {
            await sock.groupParticipantsUpdate(id, participants, action === 'promote' ? 'demote' : 'promote');
            await sock.sendMessage(id, {
              text: '🔒 Anti-action is ON — only the owner can promote/demote members.',
            });
          } catch (e) {}
          return;
        }
      }

      const metadata = await sock.groupMetadata(id);
      for (const participant of participants) {
        if (action === 'add' && settingsStore.getToggle(id, 'welcome')) {
          const defaultWelcome =
            '🌷⃝⃪⃔⃕🫵🏻 {user} 💫\n' +
            '*𓂋⃝⃟⃟⃝⃪⃔ Welcome to the family!*  ༺♛⃝ {group} ♛༻\n' +
            '               *❛❛ Where words become memories ❜❜*\n' +
            '*We gather here not just to chat, but to create little moments that stay forever 🌙🌸*\n' +
            '*May your stay be full of fun, peace, late-night talks, and beautiful friendships 🫶*\n' +
            '            *This group is a small corner of happiness in a busy world 🍃💖*\n' +
            '                       *So relax, enjoy, and feel at home ✨*\n' +
            '*Members:> {members} 🫵🎀*';
          const custom = settingsStore.getText(id, 'welcomeMsg', defaultWelcome);
          const text = custom
            .replace('{user}', `@${participant.split('@')[0]}`)
            .replace('{group}', metadata.subject)
            .replace('{members}', String(metadata.participants.length));

          let pfpUrl = null;
          try {
            pfpUrl = await sock.profilePictureUrl(participant, 'image');
          } catch (e) {
            // Profile picture na ho to koi masla nahi, sirf text bhej denge
          }

          if (pfpUrl) {
            await sock.sendMessage(id, { image: { url: pfpUrl }, caption: text, mentions: [participant] });
          } else {
            await sock.sendMessage(id, { text, mentions: [participant] });
          }
        } else if (action === 'remove' && settingsStore.getToggle(id, 'goodbye')) {
          const custom = settingsStore.getText(id, 'goodbyeMsg', '👋 {user} group se chala gaya.');
          const text = custom.replace('{user}', `@${participant.split('@')[0]}`);
          await sock.sendMessage(id, { text, mentions: [participant] });
        }
      }
    } catch (err) {
      console.error('group-participants.update error:', err);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message) return;

    if (msg.message.protocolMessage?.type === 0) {
      const deletedId = msg.message.protocolMessage.key.id;
      const cached = getCachedMessage(deletedId);
      if (cached && settingsStore.getToggle(msg.key.remoteJid, 'antidelete')) {
        const text =
          cached.message.conversation ||
          cached.message.extendedTextMessage?.text ||
          '[Media message — text uplabdh nahi]';
        await sock.sendMessage(cached.jid, {
          text: `🗑️ *Antidelete*\nKisi ne ye message delete kiya:\n\n${text}`,
        });
      }
      return;
    }

    // Reaction-based View-Once capture — 😊 = private, 📥 = usi chat mein
    if (msg.message.reactionMessage) {
      const emoji = msg.message.reactionMessage.text;
      const targetKey = msg.message.reactionMessage.key;
      if (emoji === '😊' || emoji === '📥') {
        const cached = getCachedMessage(targetKey.id);
        const viewOnceMsg =
          cached?.message?.viewOnceMessageV2?.message ||
          cached?.message?.viewOnceMessage?.message ||
          (cached?.message?.imageMessage?.viewOnce ? { imageMessage: cached.message.imageMessage } : null) ||
          (cached?.message?.videoMessage?.viewOnce ? { videoMessage: cached.message.videoMessage } : null) ||
          (cached?.message?.audioMessage?.viewOnce ? { audioMessage: cached.message.audioMessage } : null);
        if (viewOnceMsg) {
          try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage({ message: viewOnceMsg, key: cached.key || targetKey }, 'buffer', {});
            const destination = emoji === '😊' ? `${config.ownerNumber}@s.whatsapp.net` : msg.key.remoteJid;

            let mediaType = 'image';
            if (viewOnceMsg.videoMessage) mediaType = 'video';
            else if (viewOnceMsg.audioMessage) mediaType = 'audio';

            if (mediaType === 'audio') {
              await sock.sendMessage(destination, {
                audio: buffer,
                mimetype: viewOnceMsg.audioMessage.mimetype || 'audio/ogg; codecs=opus',
                ptt: false,
              });
              await sock.sendMessage(destination, { text: '🔓 View-once voice save ho gayi' });
            } else {
              await sock.sendMessage(destination, {
                [mediaType]: buffer,
                caption: '🔓 View-once media save ho gayi',
              });
            }
          } catch (err) {
            console.error('View-once reaction capture error:', err.message);
          }
        }
      }
      return;
    }

    cacheMessage(msg);

    const from = msg.key.remoteJid;
    try { require('./commands/owner').trackMessage(from); } catch (e) {}

    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (awayMode.enabled && !from.endsWith('@g.us')) {
      await sock.sendMessage(from, { text: `🌙 ${awayMode.message}` });
    }

    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (settingsStore.bannedUsers.has(senderJid) && senderJid !== `${config.ownerNumber}@s.whatsapp.net`) {
      return;
    }

    if (settingsStore.getToggle(from, 'autoread')) {
      try { await sock.readMessages([msg.key]); } catch (e) {}
    }

    if (from.endsWith('@g.us') && settingsStore.getMode(from, 'antilink') !== 'off' && !msg.key.fromMe) {
      const linkRegex = /(https?:\/\/|chat\.whatsapp\.com)/i;
      const isOwnerOrAdmin =
        senderJid === `${config.ownerNumber}@s.whatsapp.net` || (await isGroupAdmin(sock, from, senderJid));
      if (linkRegex.test(body) && !isOwnerOrAdmin) {
        await enforceModeration(sock, from, senderJid, msg, 'antilink', 'Links are not allowed in this group.');
        return;
      }
    }

    // Antistatus: agar koi apna WhatsApp Status is group mein share/mention kare
    if (from.endsWith('@g.us') && settingsStore.getMode(from, 'antistatus') !== 'off' && !msg.key.fromMe) {
      // Naye Baileys mein group status (story) ka asal wrapper ye keys hain
      const isStatusShare = Boolean(
        msg.message.groupStatusMessageV2 ||
        msg.message.groupStatusMessage
      );
      const isOwnerOrAdmin =
        senderJid === `${config.ownerNumber}@s.whatsapp.net` || (await isGroupAdmin(sock, from, senderJid));
      if (isStatusShare && !isOwnerOrAdmin) {
        await enforceModeration(sock, from, senderJid, msg, 'antistatus', 'Status sharing is not allowed in this group.');
        return;
      }
    }

    // Antisticker: stickers group mein delete kar do
    if (from.endsWith('@g.us') && settingsStore.getMode(from, 'antisticker') !== 'off' && !msg.key.fromMe) {
      const isOwnerOrAdmin =
        senderJid === `${config.ownerNumber}@s.whatsapp.net` || (await isGroupAdmin(sock, from, senderJid));
      if (msg.message.stickerMessage && !isOwnerOrAdmin) {
        await enforceModeration(sock, from, senderJid, msg, 'antisticker', 'Stickers are not allowed in this group.');
        return;
      }
    }

    // Antivideos: videos group mein delete kar do
    if (from.endsWith('@g.us') && settingsStore.getMode(from, 'antivideos') !== 'off' && !msg.key.fromMe) {
      const isOwnerOrAdmin =
        senderJid === `${config.ownerNumber}@s.whatsapp.net` || (await isGroupAdmin(sock, from, senderJid));
      if (msg.message.videoMessage && !isOwnerOrAdmin) {
        await enforceModeration(sock, from, senderJid, msg, 'antivideos', 'Videos are not allowed in this group.');
        return;
      }
    }

    if (!body.startsWith(config.prefix)) return;

    // Private mode: sirf owner ki commands work karengi, kisi aur ko koi response nahi
    if (config.mode === 'private' && senderJid !== `${config.ownerNumber}@s.whatsapp.net` && !msg.key.fromMe) {
      return;
    }

    const args = body.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const command = commands.get(commandName);
    if (!command) return;

    try {
      await command.execute({ sock, msg, from, args, config });
    } catch (err) {
      console.error(`❌ Command "${commandName}" mein error:`, err);
      await sock.sendMessage(from, { text: '❌ Command chalate waqt error aa gaya.' });
    }
  });

  if (pairingCode) {
    setTimeout(() => {
      const current = sessions.get(key);
      if (current && current.status === 'connecting') {
        console.log(`[${key}] ⏱️ Pairing timeout — session reset ho rahi hai.`);
        try { sock.end(); } catch (e) {}
        sessions.delete(key);
        try {
          fs.rmSync(path.join('session', number, deviceId), { recursive: true, force: true });
        } catch (e) {}
      }
    }, 90000);
  }

  return { pairingCode, deviceId };
}

async function startBot(phoneNumber) {
  const number = sanitizeNumber(phoneNumber);
  if (!number) throw new Error('Number chahiye');

  // Naya pairing shuru karne se pehle, isi number ki SAARI purani sessions delete karo —
  // ek number, ek hi active session (multiple sessions "Bad MAC" errors aur duplicate replies create karti hain)
  const numberPath = path.join(__dirname, 'session', number);
  if (fs.existsSync(numberPath)) {
    try {
      fs.rmSync(numberPath, { recursive: true, force: true });
      console.log(`[${number}] 🧹 Purani sessions clear kar di gayin naye pairing se pehle.`);
    } catch (e) {}
  }
  // In-memory mein bhi is number ki koi purani entry ho to hata do
  for (const key of sessions.keys()) {
    if (key.startsWith(`${number}::`)) sessions.delete(key);
  }

  const deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return connectSocket(number, deviceId, true);
}

/**
 * Server start hote hi ye function purani saved sessions (session/ folder) dhoondh kar
 * unhe automatically reconnect kar deta hai — dobara pairing code mangne ki zaroorat nahi.
 * Har number ki SIRF sabse nayi deviceId resume hoti hai; baaki purani duplicate ho to
 * automatically delete kar di jaati hain (taake "Bad MAC"/duplicate-reply errors na aayein).
 */
function resumeSessions() {
  const sessionRoot = path.join(__dirname, 'session');
  if (!fs.existsSync(sessionRoot)) return;

  const numbers = fs.readdirSync(sessionRoot).filter((n) => {
    return fs.statSync(path.join(sessionRoot, n)).isDirectory();
  });

  for (const number of numbers) {
    const numberPath = path.join(sessionRoot, number);
    const deviceIds = fs.readdirSync(numberPath).filter((d) => {
      return fs.statSync(path.join(numberPath, d)).isDirectory();
    });

    // Valid (creds.json wali) deviceIds ko unke creation time ke hisaab se sort karo — naya pehle
    const validDeviceIds = deviceIds
      .filter((d) => fs.existsSync(path.join(numberPath, d, 'creds.json')))
      .sort((a, b) => {
        const timeA = fs.statSync(path.join(numberPath, a, 'creds.json')).mtimeMs;
        const timeB = fs.statSync(path.join(numberPath, b, 'creds.json')).mtimeMs;
        return timeB - timeA; // Naya (zyada mtime) pehle
      });

    if (validDeviceIds.length === 0) continue;

    const keepDeviceId = validDeviceIds[0];
    const extraDeviceIds = validDeviceIds.slice(1);

    // Extra (purani duplicate) sessions delete kar do
    for (const extra of extraDeviceIds) {
      try {
        fs.rmSync(path.join(numberPath, extra), { recursive: true, force: true });
        console.log(`[${number}::${extra}] 🧹 Duplicate purani session delete kar di.`);
      } catch (e) {}
    }

    console.log(`[${number}::${keepDeviceId}] 🔄 Purani session mil gayi, reconnect kar raha hoon...`);
    connectSocket(number, keepDeviceId, false).catch((err) => {
      console.error(`[${number}::${keepDeviceId}] Resume error:`, err.message);
    });
  }
}

resumeSessions();

module.exports = { startBot, getSock, getStatus, getAllSessions };
