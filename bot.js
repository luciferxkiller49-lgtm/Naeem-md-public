const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  getContentType
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');
const logger = require('./lib/quietLogs');
const { useMongoDBAuthState, getAppSessions } = require('./lib/mongoAuth');
const store = require('./lib/store');
const capacity = require('./lib/capacity');
const safety = require('./lib/safety');
const registry = require('./lib/loadCommands');
const { handleAntilink } = require('./lib/antilink');
const { cacheMessage, handleAntidelete } = require('./lib/antidel');
const { handleAntiedit } = require('./lib/antiedit');
const { handleChatbot } = require('./lib/chatbot');

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

    if (this.instances.has(cleanNumber) && !isNewPairing) {
      return this.instances.get(cleanNumber);
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
      generateHighQualityLinkPreview: true
    });

    const instanceData = {
      sock,
      number: cleanNumber,
      status: 'connecting',
      pairingCode: null
    };
    this.instances.set(cleanNumber, instanceData);

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

        try {
          const userJid = `${cleanNumber}@s.whatsapp.net`;
          const intro = await store.getIntro(cleanNumber);
          const welcomeMsg = intro ||
            `*${config.BOT_NAME} Connected!*\n` +
            `• Node: #${config.APP_ID}\n` +
            `• Prefix: ${config.DEFAULT_PREFIX}\n` +
            `• Type *${config.DEFAULT_PREFIX}menu* to see available commands.`;

          await sock.sendMessage(userJid, { text: welcomeMsg });
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
          setTimeout(() => this.startInstance(cleanNumber, false), 5000);
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

        cacheMessage(msg);

        if (await handleAntiedit(sock, msg)) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? (msg.key.participant || from) : from;
        const isMe = msg.key.fromMe;
        const botNumber = cleanNumber;

        const instanceSettings = await store.getInstanceSettings(botNumber);
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
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants || [];
            const botJid = `${botNumber}@s.whatsapp.net`;

            const botParticipant = participants.find(p => p.id.split(':')[0] === botJid.split('@')[0] || p.id === botJid);
            isBotAdmin = botParticipant ? (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin') : false;

            const senderParticipant = participants.find(p => p.id === sender);
            isSenderAdmin = senderParticipant ? (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin') : false;
          } catch (e) {}

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

        const ctx = {
          sock,
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
            return await sock.sendMessage(from, { text: replyText }, { quoted: msg });
          },
          react: async (emoji) => {
            return await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
          }
        };

        await cmd.execute(ctx);

      } catch (err) {
        console.error('[BOT-MGR] Error processing message:', err);
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update?.messageStubType === 68 || update.update?.message === null) {
          await handleAntidelete(sock, update);
        }
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
