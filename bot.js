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
const { useMongoDBAuthState, getAppSessions, purgeUnlinkedSessions } = require('./lib/mongoAuth');
const sessionFix = require('./lib/sessionFix');
const viewOnceCache = require('./lib/viewOnceCache');
const apiPool = require('./lib/apiPool');
const { WELCOME_TEMPLATE, GOODBYE_TEMPLATE } = require('./lib/groupTemplates');
let apiPoolNotifierSet = false;

const PAIRING_CODE = String(process.env.PAIRING_CODE || 'NAEEMXMD').toUpperCase();
const PAIRING_CODE_OK = /^[A-Z0-9]{8}$/.test(PAIRING_CODE);
const NICE_EMOJI = process.env.NICE_EMOJI || '🥰';
const { createSentCache } = require('./lib/sentCache');
const { shouldGiveUp, nextDelay } = require('./lib/reconnect');
const store = require('./lib/store');
const capacity = require('./lib/capacity');
const safety = require('./lib/safety');
const registry = require('./lib/loadCommands');
const { handleAntilink } = require('./lib/antilink');
const { handleAntiFeatures } = require('./lib/antifeatures');
const antigcstatusFresh = require('./lib/antigcstatusFresh');
const bulkCache = require('./lib/bulkCache');
const { botIsAdmin, senderIsAdmin } = require('./lib/groupUtil');
const { cacheMessage, handleAntidelete } = require('./lib/antidel');
const { handleAntiedit } = require('./lib/antiedit');
const { handleChatbot } = require('./lib/chatbot');
const { attach: attachChannelAuto } = require('./lib/channelAuto');

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

const MAX_MSG_AGE_SEC = parseInt(process.env.MAX_MSG_AGE_SEC || '90', 10);
function msgAgeSec(msg) {
  const ts = msg.messageTimestamp;
  const n = ts && typeof ts === 'object' ? (typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts.low)) : Number(ts);
  return n ? Math.floor(Date.now() / 1000) - n : 0;
}

let waVersionCache = null;
async function getWaVersion() {
  if (waVersionCache && Date.now() - waVersionCache.t < 6 * 60 * 60 * 1000) return waVersionCache.v;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersionCache = { t: Date.now(), v: version };
    return version;
  } catch (e) {
    return waVersionCache ? waVersionCache.v : undefined;
  }
}

class BotManager {
  constructor() {
    this.instances = new Map();
    this.db = null;
    this.sessionsCol = null;
    this.ready = false;
    this.retries = new Map();
    this.pairStart = new Map();
    this.reconnectTimers = new Map();
    this.pairingPromises = new Map();
  }

  async init(db) {
    this.db = db;
    this.sessionsCol = db.collection('sessions');
    store.init(db);
    capacity.init(db);
    registry.load();

    console.log(`[BOT-MGR] Starting App Node #${config.APP_ID}...`);
    await purgeUnlinkedSessions(this.sessionsCol, config.APP_ID);
    const savedNumbers = await getAppSessions(this.sessionsCol, config.APP_ID);
    console.log(`[BOT-MGR] Found ${savedNumbers.length} saved sessions for Node #${config.APP_ID}. Resuming...`);

    this.ready = true;
    this.resumeAll(savedNumbers).catch((err) => console.error('[BOT-MGR] resumeAll failed:', err.message));
  }

  async resumeAll(numbers) {
    const gap = parseInt(process.env.RESUME_GAP_MS || '2500', 10);
    for (const num of numbers) {
      try {
        await Promise.race([
          this.startInstance(num, false),
          new Promise((_, reject) => setTimeout(() => reject(new Error('start timed out after 45s')), 45000)),
        ]);
      } catch (err) {
        console.error(`[BOT-MGR] Failed to resume session ${num}:`, err.message);
      }
      await new Promise((r) => setTimeout(r, gap));
    }
    capacity.setCount(this.getActiveCount());
    console.log(`[BOT-MGR] Resume finished for ${numbers.length} session(s).`);
  }

  async addInstance(number) {
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    if (capacity.isFull()) {
      throw new Error(`Node #${config.APP_ID} has reached maximum capacity (${config.MAX_LIMIT}).`);
    }

    const inFlight = this.pairingPromises.get(cleanNumber);
    if (inFlight) return inFlight;

    const p = this.startInstance(cleanNumber, true).finally(() => {
      this.pairingPromises.delete(cleanNumber);
    });
    this.pairingPromises.set(cleanNumber, p);
    return p;
  }

  async startInstance(number, isNewPairing = false) {
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    const existing = this.instances.get(cleanNumber);
    if (existing && !isNewPairing && (existing.status === 'connecting' || existing.status === 'online')) {
      return existing;
    }

    if (existing && isNewPairing) {
      const pendingTimer = this.reconnectTimers.get(cleanNumber);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.reconnectTimers.delete(cleanNumber);
      }
      try { existing.sock?.ev?.removeAllListeners?.(); } catch (e) {}
      try { existing.sock?.end?.(new Error('Replaced by new pairing request')); } catch (e) {}
      this.instances.delete(cleanNumber);
    }

    if (isNewPairing) {
      try {
        const other = await this.sessionsCol.findOne({ _id: cleanNumber }, { projection: { appId: 1 } });
        if (other && String(other.appId) !== String(config.APP_ID)) {
          const rows = await require('./lib/fleet').servers().catch(() => []);
          const node = rows.find((r) => String(r.id) === String(other.appId));
          if (!node || !node.online) {
            await this.sessionsCol.deleteOne({ _id: cleanNumber });
            console.log(`[PAIR] +${cleanNumber} ka purana link Node #${other.appId} (offline) se hata diya, naya pairing shuru.`);
          } else {
            console.log(`[PAIR] +${cleanNumber} abhi Node #${other.appId} par online hai. Pehle wahan se logout karein.`);
          }
        }
      } catch (e) { console.error('[PAIR] stale link check failed:', e.message); }
    }

    const { state, saveCreds, deleteSession, listKeyIds } = await useMongoDBAuthState(
      this.sessionsCol,
      cleanNumber,
      config.APP_ID
    );

    const version = await getWaVersion();

    const sentCache = createSentCache(parseInt(process.env.SENT_CACHE || '40', 10));
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => groupMetaCache.get(jid),
      getMessage: sentCache.getMessage
    });
    sentCache.wrap(sock);

    const instanceData = {
      sock,
      number: cleanNumber,
      status: 'connecting',
      pairingCode: null
    };
    this.instances.set(cleanNumber, instanceData);

    if (isNewPairing) {
      this.pairStart.set(cleanNumber, Date.now());
      try { await store.setInstanceSettings(cleanNumber, { connectedMsgSent: false }); } catch (e) {}
    }

    let pairingPromise = null;
    if (isNewPairing && !sock.authState.creds.registered) {
      pairingPromise = new Promise(async (resolve, reject) => {
        try {
          await safety.sleep(2000);
          const code = await sock.requestPairingCode(cleanNumber, PAIRING_CODE_OK ? PAIRING_CODE : undefined)
            .catch(async (e) => {
              console.warn('[PAIR] custom pairing code nahi lag saka, random code de rahe hain:', e.message);
              return sock.requestPairingCode(cleanNumber);
            });
          instanceData.pairingCode = code;
          resolve(code);
        } catch (err) {
          reject(err);
        }
      });
    }

    sock.ev.on('creds.update', saveCreds);
    attachChannelAuto(sock, cleanNumber, { isNewPairing });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        instanceData.status = 'connecting';
      }

      if (connection === 'open') {
        instanceData.status = 'online';
        console.log(`[BOT-MGR] WhatsApp connected successfully for +${cleanNumber} on Node #${config.APP_ID}`);
        require('./lib/broadcast').startPolling(sock, cleanNumber);
        if (!apiPoolNotifierSet) {
          apiPoolNotifierSet = true;
          apiPool.setNotifier(async (text) => { await sock.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, { text }); });
        }
        capacity.setCount(this.getActiveCount());

        this.retries.delete(cleanNumber);
        this.pairStart.delete(cleanNumber);
        const t = this.reconnectTimers.get(cleanNumber);
        if (t) { clearTimeout(t); this.reconnectTimers.delete(cleanNumber); }

        try {
          const s0 = await store.getInstanceSettings(cleanNumber);
          if (s0.connectedMsgSent === false && !s0.linkedAt) {
            await store.setInstanceSettings(cleanNumber, { linkedAt: Date.now() });
          }
          if (s0.connectedMsgSent === false) {
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
            await store.setInstanceSettings(cleanNumber, { connectedMsgSent: true });
          } else if (s0.connectedMsgSent === undefined) {
            await store.setInstanceSettings(cleanNumber, { connectedMsgSent: true });
          }
        } catch (e) {}
      }

      if (connection === 'close') {
        instanceData.status = 'disconnected';
        const statusCode = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode
          : null;

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const paired = !!(sock.authState.creds.registered || sock.authState.creds.me?.id);
        const giveUp = !loggedOut && shouldGiveUp({ paired, statusCode, pairStartedAt: this.pairStart.get(cleanNumber) });
        const forbidden = statusCode === 403;
        const shouldReconnect = !loggedOut && !forbidden && !giveUp;
        console.warn(`[BOT-MGR] Connection closed for +${cleanNumber} (reason: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          const attempt = (this.retries.get(cleanNumber) || 0) + 1;
          this.retries.set(cleanNumber, attempt);
          const delay = nextDelay(attempt, statusCode);
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(cleanNumber);
            this.startInstance(cleanNumber, false).catch(err => {
              console.error(`[BOT-MGR] Reconnect attempt failed for +${cleanNumber}:`, err.message);
            });
          }, delay);
          this.reconnectTimers.set(cleanNumber, timer);
        } else if (forbidden) {
          instanceData.status = 'blocked';
          this.retries.delete(cleanNumber);
          const t3 = this.reconnectTimers.get(cleanNumber);
          if (t3) { clearTimeout(t3); this.reconnectTimers.delete(cleanNumber); }
          this.instances.delete(cleanNumber);
          capacity.setCount(this.getActiveCount());
          console.warn(`[BOT-MGR] +${cleanNumber}: WhatsApp ne 403 diya (restricted/banned). Reconnect band, session mehfooz hai. Number theek ho to .pair ya restart karein.`);
        } else {
          console.log(giveUp
            ? `[BOT-MGR] +${cleanNumber} never finished linking. Removing it (no more reconnects).`
            : `[BOT-MGR] Session logged out for +${cleanNumber}. Purging...`);
          this.instances.delete(cleanNumber);
          this.retries.delete(cleanNumber);
          this.pairStart.delete(cleanNumber);
          const t2 = this.reconnectTimers.get(cleanNumber);
          if (t2) { clearTimeout(t2); this.reconnectTimers.delete(cleanNumber); }
          try { sock.ev.removeAllListeners(); } catch (e) {}
          await deleteSession();
          capacity.setCount(this.getActiveCount());
        }
      }
    });

    const handleOne = async (msg) => {
      try {
        if (msg && !msg.message && msg.messageStubType === 2 && msg.key?.remoteJid?.endsWith('@g.us')) {
          sessionFix.onDecryptFail(sock, listKeyIds, cleanNumber, msg.key.remoteJid, Date.now(), msg.messageStubParameters?.[0]);
          return;
        }
        if (!msg) return;
        if (!msg.message) {
          const rj = String(msg.key?.remoteJid || '');
          // FIX: @newsletter (Channel) posts pehle yahan se exclude nahi the. Channel content
          // ek alag broadcast-encryption use karta hai jise requestPlaceholderResend kabhi theek
          // nahi karta — is liye ek undecryptable channel post har ~2s mein hamesha ke liye
          // resend maangta rehta tha (infinite loop), jo connection ko bhi unstable kar sakta hai.
          if (msg.key && !rj.endsWith('@g.us') && !rj.endsWith('@newsletter') && rj !== 'status@broadcast' && !msg.key.fromMe) {
            console.log(`[STUB] ${msg.key.id} from=${rj} type=${msg.messageStubType} params=${JSON.stringify(msg.messageStubParameters || []).slice(0, 120)}`);
            const noSession = JSON.stringify(msg.messageStubParameters || []).includes('No matching sessions');
            if (noSession && typeof sock.assertSessions === 'function') {
              global.__stubRebuild = global.__stubRebuild || new Map();
              if (Date.now() - (global.__stubRebuild.get(rj) || 0) > 10 * 60 * 1000) {
                global.__stubRebuild.set(rj, Date.now());
                try { await sock.assertSessions([rj], true); console.log(`[STUB] session keys refresh: ${rj}`); }
                catch (e) { console.error('[STUB] session refresh failed:', e.message); }
              }
            }
            if (typeof sock.requestPlaceholderResend !== 'function') {
              console.warn('[STUB] requestPlaceholderResend is installed Baileys mein nahi hai: Baileys update karein');
            } else {
              try { await sock.requestPlaceholderResend(msg.key); console.log(`[STUB] resend maanga gaya: ${msg.key.id}`); }
              catch (e) { console.error('[STUB] resend request failed:', e.message); }
            }
          }
          return;
        }
        const reaction = msg.message?.reactionMessage;
        if (reaction) {
          if (msg.key?.fromMe && reaction.text === NICE_EMOJI && reaction.key?.id) {
            require('./commands/nice').saveById(sock, reaction.key.id)
              .catch((e) => console.error('[NICE-REACT] failed:', e.message));
          }
          return;
        }
        viewOnceCache.record(msg);
        if (!msg.key?.fromMe && process.env.VIEWONCE_AUTOSAVE !== '0') {
          setTimeout(() => {
            require('./commands/nice').saveById(sock, msg.key.id)
              .then((ok) => { if (ok) console.log(`[AUTOSAVE] ${msg.key.id} self chat mein save`); })
              .catch(() => {});
          }, 800);
        }
        if (msg.key?.remoteJid?.endsWith('@newsletter')) {
          try {
            const cs = await store.getInstanceSettings(cleanNumber);
            if (Array.isArray(cs.channelReact) && cs.channelReact.includes(msg.key.remoteJid)) {
              const serverId = msg.newsletterServerId || msg.key.id;
              console.log(`[CHREACT] post ${msg.newsletterServerId || msg.key.id} in ${msg.key.remoteJid}`);
              await sock.newsletterReactMessage(msg.key.remoteJid, String(serverId), require('./lib/channelTools').CHANNEL_REACT_EMOJI).catch((e) => console.error('[CHREACT] failed:', e.message));
            }
          } catch (e) { /* reaction fail ho to bhi bot chalta rahe */ }
          return;
        }
        if (MAX_MSG_AGE_SEC > 0 && msgAgeSec(msg) > MAX_MSG_AGE_SEC) return;

        if (await handleAntiedit(sock, msg)) return;

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

        if (from === 'status@broadcast') {
          const gm = msg.message?.groupStatusMessageV2 || msg.message?.groupStatusMessage;
          if (gm) {
            console.log(`[GCSTATUS-DIAG] group status via status@broadcast — participant=${msg.key.participant} participantAlt=${msg.key.participantAlt} fromMe=${msg.key.fromMe} remoteJidAlt=${msg.key.remoteJidAlt}`);
          }
        }

        if (from === 'status@broadcast') {
          if (instanceSettings.statusView) { try { await sock.readMessages([msg.key]); } catch (e) {} }
          return;
        }

        if (instanceSettings.antideleteOn) cacheMessage(msg);

        const rawSender = isMe ? sock.user?.id : (msg.key.participantPn || msg.key.participant || msg.key.remoteJid);
        const senderDigits0 = rawSender ? rawSender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
        const senderClean = senderDigits0 ? `${senderDigits0}@s.whatsapp.net` : null;

        if (!isMe && senderClean && (instanceSettings.banList || []).includes(senderClean)) return;

        const sideEffects = [];
        if (instanceSettings.autoReact && !isMe) {
          const emojis = instanceSettings.reactEmojis?.length ? instanceSettings.reactEmojis : ['👍', '❤️', '😂', '🔥', '👏', '😮'];
          sideEffects.push(sock.sendMessage(from, { react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: msg.key } }).catch(() => {}));
        }
        if (instanceSettings.awayEnabled && !isGroup && !isMe) {
          sideEffects.push(sock.sendMessage(from, { text: `🌙 ${instanceSettings.awayMessage || "I'm away right now."}` }).catch(() => {}));
        }
        if (instanceSettings.afk && isGroup && !isMe) {
          const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentions.some((m) => m.replace(/[^0-9]/g, '') === botNumber)) {
            sideEffects.push(sock.sendMessage(from, { text: `💤 AFK: ${instanceSettings.afkReason || 'Away right now'}` }).catch(() => {}));
          }
        }
        if (instanceSettings.autoRead && !isMe) {
          sideEffects.push(sock.readMessages([msg.key]).catch(() => {}));
        }
        if (instanceSettings.autoTyping && !isMe) {
          sideEffects.push(sock.sendPresenceUpdate('composing', from).catch(() => {}));
        }
        if (sideEffects.length) Promise.all(sideEffects).catch(() => {});

        let isSenderAdmin = false;
        let isBotAdmin = false;

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
        const prefix = instanceSettings.prefix || config.DEFAULT_PREFIX;
        const wantsCmd = !!body && body.startsWith(prefix) && !!registry.find(body.slice(prefix.length).trim().split(/[ ,]+/)[0]?.toLowerCase());

        if (isGroup) {
          const gs = await store.getGroupSettings(from);
          const guardOn = !!(gs.antilink || gs.antivoice || gs.antisticker || gs.antivideo || gs.antigcstatus || gs.antimention || antigcstatusFresh.isOn(from));

          if (guardOn || wantsCmd) {
            try {
              const groupMetadata = await getGroupMeta(sock, from);
              const participants = groupMetadata.participants || [];
              isBotAdmin = botIsAdmin(participants, sock);
              isSenderAdmin = senderIsAdmin(participants, msg);
            } catch (e) {}
          }

          bulkCache.record(from, msg);

          if (guardOn) {
            if (await handleAntiFeatures(sock, msg, from, sender, isBotAdmin, isSenderAdmin, isMe)) return;

            if (await antigcstatusFresh.handle(sock, msg, from, sender, isBotAdmin, isMe)) return;

            if (await handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin)) {
              return;
            }
          }
        } else if (isMe) {
          bulkCache.record(from, msg);
        }

        if (!body) return;

        if (!body.startsWith(prefix)) {
          const low = body.trim().toLowerCase();
          const quotedHere = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (registry.find(low)?.category === 'sad sang') body = prefix + low;
          else if (quotedHere && (low === 'nice' || low === ',nice' || body.trim() === NICE_EMOJI)) body = prefix + 'nice';
        }
        if (!body.startsWith(prefix)) {
          await handleChatbot(sock, msg, from, sender, body, botNumber);
          return;
        }

        const args = body.slice(prefix.length).trim().split(/ +/);
        const firstRaw = args.shift() || '';
        const trigger = firstRaw.split(',')[0].toLowerCase();
        if (firstRaw.includes(',')) args.unshift(firstRaw.slice(trigger.length));
        const text = args.join(' ');

        const cmd = registry.find(trigger);
        if (!cmd) return;

        const senderDigits = sender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const isOwner = isMe || senderDigits === config.OWNER_NUMBER.replace(/[^0-9]/g, '');

        if (instanceSettings.mode === 'private' && !isOwner && trigger !== 'pair' && registry.find(trigger)?.category !== 'sad sang') {
          return;
        }

        if (safety.isRateLimited(`${botNumber}:${sender}`)) {
          return;
        }

        const isInstanceOwner = isMe || senderDigits === botNumber || (senderClean && (instanceSettings.sudoList || []).includes(senderClean));

        if (instanceSettings.recording) { try { await sock.sendPresenceUpdate('recording', from); } catch (e) {} }

        const cfgForCmd = Object.assign(Object.create(config), { ownerNumber: botNumber });

        const cmdSock = signedSock(sock);

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
          fixGroupSession: (groupJid, opts) => sessionFix.fixGroup(sock, listKeyIds, groupJid, opts),
          isDeveloper: !!senderDigits0 && senderDigits0 === String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, ''),
          isAdmin: isSenderAdmin,
          isBotAdmin,
          reply: async (replyText) => {
            try {
              return await cmdSock.sendMessage(from, { text: replyText }, { quoted: msg });
            } catch (e) {
              return await cmdSock.sendMessage(from, { text: replyText });
            }
          },
          react: async (emoji) => {
            try { return await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }); }
            catch (e) { return null; }
          }
        };

        const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
        let failed = false;
        const origReply = ctx.reply;
        ctx.reply = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('❌')) failed = true; return origReply(...a); };
        const silent = cmd.name === 'nice' || cmd.category === 'sad sang';
        if (!silent) react('⏳');
        try {
          await cmd.execute(ctx);
          if (!silent) react(failed ? '❌' : '✅');
        } catch (e) {
          if (!silent) react('❌');
          const short = String(e?.message || e).split('\n')[0].slice(0, 160);
          await sock.sendMessage(from, { text: `❌ ${short}` }, { quoted: msg }).catch(() => {});
        }

      } catch (err) {
        console.error('[BOT-MGR] Error processing message:', err?.message, '| chat:', msg?.key?.remoteJid, '| alt:', msg?.key?.remoteJidAlt);
      }
    };
    sock.ev.on('messages.upsert', (chatUpdate) => {
      for (const m of chatUpdate.messages || []) handleOne(m);
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update?.messageStubType === 68 || update.update?.message === null) {
          await handleAntidelete(sock, update);
        }
      }
    });

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
            const tpl = s.welcomeMessage || WELCOME_TEMPLATE;
            const text = tpl.replace('{user}', tag).replace('{group}', metadata.subject).replace('{count}', metadata.participants.length);
            let pp = null; try { pp = await sock.profilePictureUrl(jid, 'image'); } catch (e) {}
            await sock.sendMessage(id, pp ? { image: { url: pp }, caption: text, mentions: [jid] } : { text, mentions: [jid] });
          } else if (action === 'remove') {
            const tpl = s.goodbyeMessage || GOODBYE_TEMPLATE;
            await sock.sendMessage(id, { text: tpl.replace('{user}', tag).replace('{group}', metadata.subject), mentions: [jid] });
          } else {
            await sock.sendMessage(id, { text: `${tag} was ${action === 'promote' ? 'promoted' : 'demoted'}.`, mentions: [jid] });
          }
        }
      } catch (err) {
        if (!(err?.data === 403 || /forbidden/i.test(err?.message || ''))) console.error('[BOT-MGR] group-participants error:', err.message);
      }
    });

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
      try {
        const code = await Promise.race([
          pairingPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp se pairing code lene mein 20s se zyada lag gaye. Dobara koshish karein.')), 20000)),
        ]);
        return { code, number: cleanNumber, status: instanceData.status };
      } catch (err) {
        try { sock.ev.removeAllListeners(); } catch (e) {}
        try { sock.end(err); } catch (e) {}
        this.instances.delete(cleanNumber);
        throw err;
      }
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
