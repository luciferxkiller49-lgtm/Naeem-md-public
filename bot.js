const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  getContentType
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const { signedSock } = require('./lib/signature');
const { buildConnectMessage } = require('./lib/connectMessage');
const config = require('./config');
const logger = require('./lib/quietLogs');
const { useMongoDBAuthState, getAppSessions } = require('./lib/mongoAuth');
const store = require('./lib/store');
const capacity = require('./lib/capacity');
const safety = require('./lib/safety');
const registry = require('./lib/loadCommands');
const { handleAntilink } = require('./lib/antilink');
const { handleAntiFeatures } = require('./lib/antifeatures');
const { botIsAdmin, senderIsAdmin } = require('./lib/groupUtil');
const { cacheMessage, handleAntidelete } = require('./lib/antidel');
const { handleAntiedit } = require('./lib/antiedit');
const { handleChatbot } = require('./lib/chatbot');

// Baileys ka version (v7 LID natively handle karta hai, purane version ko phone-number JID chahiye)
// Group ki maloomat 5 minute yaad rakhte hain (har message par WhatsApp se dobara nahi maangte)
const groupMetaCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });
async function getGroupMeta(sock, jid) {
  let meta = groupMetaCache.get(jid);
  if (!meta) {
    meta = await sock.groupMetadata(jid);
    groupMetaCache.set(jid, meta);
  }
  return meta;
}

let BAILEYS_VERSION = 'unknown';
try {
  const _p = require('path').join(require('path').dirname(require.resolve('@whiskeysockets/baileys')), '..', 'package.json');
  BAILEYS_VERSION = JSON.parse(require('fs').readFileSync(_p, 'utf8')).version;
} catch (e) {}
const BAILEYS_MAJOR = parseInt(BAILEYS_VERSION, 10) || 6;
console.log(`[BOT-MGR] Baileys version: ${BAILEYS_VERSION}`);

class BotManager {
  constructor() {
    this.instances = new Map(); // number -> { sock, number, status }
    this.db = null;
    this.sessionsCol = null;
  }

  async init(db) {
    this.db = db;
    this.sessionsCol = db.collection('sessions');
    store.init(db);
    capacity.init(db);
    registry.load();

    console.log(`[BOT-MGR] Starting App Node #${config.APP_ID}...`);
    const savedNumbers = await getAppSessions(this.sessionsCol, config.APP_ID);
    console.log(`[BOT-MGR] Found ${savedNumbers.length} saved sessions for Node #${config.APP_ID}. Resuming...`);

    for (const num of savedNumbers) {
      try {
        await this.startInstance(num, false);
      } catch (err) {
        console.error(`[BOT-MGR] Failed to resume session ${num}:`, err.message);
      }
    }

    // FIX: was `capacity.setCount(this.instances.size)` here, which counts
    // sockets that are still 'connecting' as if they were live. /active (in
    // server.js) reports getActiveCount() (only 'online'). Using the same
    // metric here keeps the panel's capacity view and /active in agreement.
    capacity.setCount(this.getActiveCount());
  }

  async addInstance(number) {
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    if (capacity.isFull()) {
      throw new Error(`Node #${config.APP_ID} has reached maximum capacity (${config.MAX_LIMIT}).`);
    }

    return await this.startInstance(cleanNumber, true);
  }

  async startInstance(number, isNewPairing = false) {
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    // FIX: this was the actual bug behind "pairing code works, phone shows
    // loading, then 'could not link device' after ~1 minute". On a 515
    // stream error (which happens routinely right after a pairing code is
    // entered — see the connection.update handler below) we schedule a
    // reconnect via startInstance(number, false), but we never remove the
    // dead entry from `this.instances`. The old check here was
    // `if (this.instances.has(cleanNumber) && !isNewPairing)`, which is
    // true as soon as ANY entry exists for that number — including a
    // disconnected one — so the scheduled reconnect just returned the
    // stale, dead instance object and never opened a new WhatsApp socket at
    // all. No new logs, no real reconnect, phone times out waiting.
    // Only short-circuit if the existing instance is actually alive.
    const existing = this.instances.get(cleanNumber);
    if (existing && !isNewPairing && (existing.status === 'connecting' || existing.status === 'online')) {
      return existing;
    }

    const { state, saveCreds, deleteSession } = await useMongoDBAuthState(
      this.sessionsCol,
      cleanNumber,
      config.APP_ID
    );

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => groupMetaCache.get(jid)
    });

    const instanceData = {
      sock,
      number: cleanNumber,
      status: 'connecting',
      pairingCode: null
    };
    this.instances.set(cleanNumber, instanceData);

    if (isNewPairing) {
      try { await store.setInstanceSettings(cleanNumber, { connectedMsgSent: false }); } catch (e) {}
    }

    let pairingPromise = null;
    if (isNewPairing && !sock.authState.creds.registered) {
      pairingPromise = new Promise(async (resolve, reject) => {
        try {
          await safety.sleep(2000);
          const code = await sock.requestPairingCode(cleanNumber);
          instanceData.pairingCode = code;
          resolve(code);
        } catch (err) {
          reject(err);
        }
      });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        instanceData.status = 'connecting';
      }

      if (connection === 'open') {
        instanceData.status = 'online';
        console.log(`[BOT-MGR] WhatsApp connected successfully for +${cleanNumber} on Node #${config.APP_ID}`);
        // FIX: use getActiveCount() (see note in init())
        capacity.setCount(this.getActiveCount());

        // "Connected" message sirf pehli baar (jab number naya link hota hai), har restart par nahi
        try {
          const s0 = await store.getInstanceSettings(cleanNumber);
          if (s0.connectedMsgSent === false) {
            await store.setInstanceSettings(cleanNumber, { connectedMsgSent: true });
            const userJid = `${cleanNumber}@s.whatsapp.net`;
            const intro = await store.getIntro(cleanNumber);
            const built = buildConnectMessage({
              number: cleanNumber,
              prefix: s0.prefix || config.DEFAULT_PREFIX,
              mode: s0.mode,
              plugins: registry.getAll().length,
            });
            const caption = intro || built.text;
            if (built.videoPath) {
              await sock.sendMessage(userJid, { video: { url: built.videoPath }, mimetype: 'video/mp4', caption });
            } else {
              await sock.sendMessage(userJid, { text: caption });
            }
          } else if (s0.connectedMsgSent === undefined) {
            // purane (pehle se linked) numbers: unhe dobara message nahi bhejna
            await store.setInstanceSettings(cleanNumber, { connectedMsgSent: true });
          }
        } catch (e) {}
      }

      if (connection === 'close') {
        instanceData.status = 'disconnected';
        const statusCode = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.warn(`[BOT-MGR] Connection closed for +${cleanNumber} (reason: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          // FIX: added .catch() — previously a rejected promise here would
          // have failed completely silently (no log at all), making this
          // exact class of bug nearly impossible to diagnose from logs.
          setTimeout(() => {
            this.startInstance(cleanNumber, false).catch(err => {
              console.error(`[BOT-MGR] Reconnect attempt failed for +${cleanNumber}:`, err.message);
            });
          }, 5000);
        } else {
          console.log(`[BOT-MGR] Session logged out for +${cleanNumber}. Purging...`);
          this.instances.delete(cleanNumber);
          await deleteSession();
          // FIX: use getActiveCount() (see note in init())
          capacity.setCount(this.getActiveCount());
        }
      }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return;

        if (await handleAntiedit(sock, msg)) return;

        // LID chat ID par reply bhejne se "not-acceptable" (406) aata hai — phone JID dhoondh kar use karte hain
        let from = msg.key.remoteJid;
        if (BAILEYS_MAJOR < 7 && from.endsWith('@lid')) {
          let pn = msg.key.remoteJidAlt;
          if (!pn) { try { pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(from); } catch (e) {} }
          if (!pn && msg.key.fromMe && sock.user?.id) pn = sock.user.id;
          if (pn) from = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        }
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? (msg.key.participant || from) : from;
        const isMe = msg.key.fromMe;
        const botNumber = cleanNumber;

        const instanceSettings = await store.getInstanceSettings(botNumber);

        // Status auto-view (statusview on ho to)
        if (from === 'status@broadcast') {
          if (instanceSettings.statusView) { try { await sock.readMessages([msg.key]); } catch (e) {} }
          return;
        }

        // Antidelete on ho tabhi message yaad rakhte hain
        if (instanceSettings.antideleteOn) cacheMessage(msg);

        // Sender ki clean ID (device suffix / lid ke bagair) — ban, sudo aur owner checks ke liye
        const rawSender = isMe ? sock.user?.id : (msg.key.participantPn || msg.key.participant || msg.key.remoteJid);
        const senderDigits0 = rawSender ? rawSender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
        const senderClean = senderDigits0 ? `${senderDigits0}@s.whatsapp.net` : null;

        // Banned user ka koi message process nahi hota
        if (!isMe && senderClean && (instanceSettings.banList || []).includes(senderClean)) return;

        // Autoreact: har message par random emoji
        if (instanceSettings.autoReact && !isMe) {
          const emojis = instanceSettings.reactEmojis?.length ? instanceSettings.reactEmojis : ['👍', '❤️', '😂', '🔥', '👏', '😮'];
          try { await sock.sendMessage(from, { react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: msg.key } }); } catch (e) {}
        }

        // Away mode: DM par auto-reply
        if (instanceSettings.awayEnabled && !isGroup && !isMe) {
          try { await sock.sendMessage(from, { text: `🌙 ${instanceSettings.awayMessage || "I'm away right now."}` }); } catch (e) {}
        }

        // AFK: group mein owner ko mention kiya jaye to auto-reply
        if (instanceSettings.afk && isGroup && !isMe) {
          const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentions.some((m) => m.replace(/[^0-9]/g, '') === botNumber)) {
            try { await sock.sendMessage(from, { text: `💤 AFK: ${instanceSettings.afkReason || 'Away right now'}` }); } catch (e) {}
          }
        }
        if (instanceSettings.autoRead && !isMe) {
          await sock.readMessages([msg.key]);
        }

        if (instanceSettings.autoTyping && !isMe) {
          await sock.sendPresenceUpdate('composing', from);
        }

        let isSenderAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
          try {
            const groupMetadata = await getGroupMeta(sock, from);
            const participants = groupMetadata.participants || [];
            isBotAdmin = botIsAdmin(participants, sock);
            isSenderAdmin = senderIsAdmin(participants, msg);
          } catch (e) {}

          if (await handleAntiFeatures(sock, msg, from, sender, isBotAdmin, isSenderAdmin, isMe)) return;

          if (await handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin)) {
            return;
          }
        }

        const type = getContentType(msg.message);
        let body = '';
        if (type === 'conversation') {
          body = msg.message.conversation;
        } else if (type === 'extendedTextMessage') {
          body = msg.message.extendedTextMessage.text;
        } else if (type === 'imageMessage') {
          body = msg.message.imageMessage.caption;
        } else if (type === 'videoMessage') {
          body = msg.message.videoMessage.caption;
        }

        if (!body) return;

        const prefix = instanceSettings.prefix || config.DEFAULT_PREFIX;

        if (!body.startsWith(prefix)) {
          await handleChatbot(sock, msg, from, sender, body, botNumber);
          return;
        }

        const args = body.slice(prefix.length).trim().split(/ +/);
        const trigger = args.shift()?.toLowerCase();
        const text = args.join(' ');

        const cmd = registry.find(trigger);
        if (!cmd) return;

        if (safety.isRateLimited(sender)) {
          return;
        }

        // FIX: this was the exact bug flagged in the original project's own
        // history doc. `sender` in a group is a participant JID like
        // "923001234567:12@s.whatsapp.net" — the ":12" device suffix. The old
        // code did `sender.replace(/[^0-9]/g, '')`, which keeps the "12" and
        // glues it onto the number (923001234567 -> 92300123456712), so it
        // could never equal OWNER_NUMBER. The owner's own commands would be
        // silently ignored in groups. Strip everything after '@' and ':'
        // first, then compare digits only.
        const senderDigits = sender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const isOwner = isMe || senderDigits === config.OWNER_NUMBER.replace(/[^0-9]/g, '');

        if (instanceSettings.mode === 'private' && !isOwner) {
          return;
        }

        // Linked number ka asli owner (ya uska diya hua sudo). Developer ka OWNER_NUMBER user ke account par control nahi rakhta.
        const isInstanceOwner = isMe || senderDigits === botNumber || (senderClean && (instanceSettings.sudoList || []).includes(senderClean));

        if (instanceSettings.recording) { try { await sock.sendPresenceUpdate('recording', from); } catch (e) {} }

        // Legacy (Katabump) commands config.ownerNumber ko "is bot ka owner" samajhte hain — yahan wo linked number hai
        const cfgForCmd = Object.assign(Object.create(config), { ownerNumber: botNumber });

        const cmdSock = signedSock(sock); // har jawab ke neeche signature

        const ctx = {
          config: cfgForCmd,
          instanceId: botNumber,
          isInstanceOwner,
          rawText: text,
          totalCommands: registry.getAll().length,
          addInstance: (num) => this.addInstance(num),
          sock: cmdSock,
          msg,
          from,
          sender,
          botNumber,
          args,
          text,
          trigger,
          prefix,
          isGroup,
          isOwner,
          isAdmin: isSenderAdmin,
          isBotAdmin,
          reply: async (replyText) => {
            try {
              return await cmdSock.sendMessage(from, { text: replyText }, { quoted: msg });
            } catch (e) {
              // quoted message ya key problem ho to bina quote ke dobara try
              return await cmdSock.sendMessage(from, { text: replyText });
            }
          },
          react: async (emoji) => {
            try { return await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }); }
            catch (e) { return null; } // reaction sirf cosmetic hai, command na ruke
          }
        };

        await cmd.execute(ctx);
        if (process.env.REACT_ON_COMMAND === '1') {
          try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (e) {}
        }

      } catch (err) {
        console.error('[BOT-MGR] Error processing message:', err?.message, '| chat:', chatUpdate?.messages?.[0]?.key?.remoteJid, '| alt:', chatUpdate?.messages?.[0]?.key?.remoteJidAlt);
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update?.messageStubType === 68 || update.update?.message === null) {
          await handleAntidelete(sock, update);
        }
      }
    });

    // Welcome / goodbye / admin-action
    sock.ev.on('groups.update', (updates) => { for (const u of updates || []) if (u.id) groupMetaCache.del(u.id); });
    sock.ev.on('group-participants.update', async (update) => {
      try {
        if (update?.id) groupMetaCache.del(update.id);
        const s = await store.getInstanceSettings(cleanNumber);
        const { id, participants, action } = update;
        if (!['add', 'remove', 'promote', 'demote'].includes(action)) return;
        if (action === 'add' || action === 'remove') {
          const gs = await store.getGroupSettings(id);
          if (action === 'add' && !gs.welcomeOn) return;
          if (action === 'remove' && !gs.goodbyeOn) return;
        }
        if ((action === 'promote' || action === 'demote') && !s.adminAction) return;
        groupMetaCache.del(id);
        const metadata = await getGroupMeta(sock, id);
        for (const part of participants) {
          const jid = typeof part === 'string' ? part : part.id || part.phoneNumber;
          if (!jid) continue;
          const tag = `@${jid.split('@')[0]}`;
          if (action === 'add') {
            const tpl = s.welcomeMessage || `{user}\n\n🌸 *WELCOME TO {group}* 🌸\n👥 Members: {count}\n— ${s.botName || config.BOT_NAME}`;
            const text = tpl.replace('{user}', tag).replace('{group}', metadata.subject).replace('{count}', metadata.participants.length);
            let pp = null; try { pp = await sock.profilePictureUrl(jid, 'image'); } catch (e) {}
            await sock.sendMessage(id, pp ? { image: { url: pp }, caption: text, mentions: [jid] } : { text, mentions: [jid] });
          } else if (action === 'remove') {
            const tpl = s.goodbyeMessage || `{user}\n🥀 GOOD BYE 🖤\n— ${s.botName || config.BOT_NAME}`;
            await sock.sendMessage(id, { text: tpl.replace('{user}', tag).replace('{group}', metadata.subject), mentions: [jid] });
          } else {
            await sock.sendMessage(id, { text: `${tag} was ${action === 'promote' ? 'promoted' : 'demoted'}.`, mentions: [jid] });
          }
        }
      } catch (err) {
        if (!(err?.data === 403 || /forbidden/i.test(err?.message || ''))) console.error('[BOT-MGR] group-participants error:', err.message);
      }
    });

    // Anticall
    sock.ev.on('call', async (calls) => {
      const s = await store.getInstanceSettings(cleanNumber);
      if (!s.antiCall) return;
      for (const call of calls) {
        try {
          await sock.rejectCall(call.id, call.from);
          if (s.anticallMessage) await sock.sendMessage(call.from, { text: s.anticallMessage });
        } catch (err) { console.error('[BOT-MGR] anticall error:', err.message); }
      }
    });

    if (pairingPromise) {
      const code = await pairingPromise;
      return { code, number: cleanNumber, status: instanceData.status };
    }

    return instanceData;
  }

  getActiveCount() {
    let count = 0;
    this.instances.forEach(i => {
      if (i.status === 'online') count++;
    });
    return count;
  }
}

const botManager = new BotManager();
module.exports = botManager;
