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

    capacity.setCount(this.instances.size);
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

    // If already running, return existing
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
          // Slight delay to allow Baileys socket handshake
          await safety.sleep(2000);
          const code = await sock.requestPairingCode(cleanNumber);
          instanceData.pairingCode = code;
          resolve(code);
        } catch (err) {
          reject(err);
        }
      });
    }

    // Save creds on change
    sock.ev.on('creds.update', saveCreds);

    // Connection events
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        instanceData.status = 'connecting';
      }

      if (connection === 'open') {
        instanceData.status = 'online';
        console.log(`[BOT-MGR] WhatsApp connected successfully for +${cleanNumber} on Node #${config.APP_ID}`);
        capacity.setCount(this.instances.size);

        // Send welcoming notification to owner
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
          // Device was unlinked / logged out
          console.log(`[BOT-MGR] Session logged out for +${cleanNumber}. Purging...`);
          this.instances.delete(cleanNumber);
          await deleteSession();
          capacity.setCount(this.instances.size);
        }
      }
    });

    // Message events
    sock.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return;

        // Cache for antidelete
        cacheMessage(msg);

        // Check if message is an edit
        if (await handleAntiedit(sock, msg)) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? (msg.key.participant || from) : from;
        const isMe = msg.key.fromMe;
        const botNumber = cleanNumber;

        // Auto read blue ticks if enabled
        const instanceSettings = await store.getInstanceSettings(botNumber);
        if (instanceSettings.autoRead && !isMe) {
          await sock.readMessages([msg.key]);
        }

        // Auto typing presence if enabled
        if (instanceSettings.autoTyping && !isMe) {
          await sock.sendPresenceUpdate('composing', from);
        }

        // Group checks
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

          // Handle antilink
          if (await handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin)) {
            return;
          }
        }

        // Extract message text
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

        // Determine prefix
        const prefix = instanceSettings.prefix || config.DEFAULT_PREFIX;

        // If not a command, check chatbot
        if (!body.startsWith(prefix)) {
          await handleChatbot(sock, msg, from, sender, body, botNumber);
          return;
        }

        // Command parsing
        const args = body.slice(prefix.length).trim().split(/ +/);
        const trigger = args.shift()?.toLowerCase();
        const text = args.join(' ');

        const cmd = registry.find(trigger);
        if (!cmd) return;

        // Safety rate limiting
        if (safety.isRateLimited(sender)) {
          return;
        }

        // Permissions check
        const isOwner = isMe || sender.replace(/[^0-9]/g, '') === config.OWNER_NUMBER.replace(/[^0-9]/g, '');

        if (instanceSettings.mode === 'private' && !isOwner) {
          return; // Private mode: only owner can run commands
        }

        // Context object
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

        // Execute command
        await cmd.execute(ctx);

      } catch (err) {
        console.error('[BOT-MGR] Error processing message:', err);
      }
    });

    // Handle Antidelete protocol messages
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
