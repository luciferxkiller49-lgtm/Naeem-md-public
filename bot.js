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

// Pairing code ka apna naam: WhatsApp par link karte waqt yahi 8-character code type hota hai (random code ki jagah)
// PAIRING_CODE Config Var se badal sakte hain. Sirf A-Z aur 0-9, theek 8 characters.
const PAIRING_CODE = String(process.env.PAIRING_CODE || 'NAEEMXMD').toUpperCase();
const PAIRING_CODE_OK = /^[A-Z0-9]{8}$/.test(PAIRING_CODE);
// Owner ka ye emoji kisi view-once par (reaction ya reply mein) bhejne se wo self chat mein save hota hai
const NICE_EMOJI = process.env.NICE_EMOJI || '🥰';
const { createSentCache } = require('./lib/sentCache');
const { shouldGiveUp, nextDelay } = require('./lib/reconnect');
const store = require('./lib/store');
const capacity = require('./lib/capacity');
const safety = require('./lib/safety');
const registry = require('./lib/loadCommands');
const { handleAntilink } = require('./lib/antilink');
const { handleAntiFeatures } = require('./lib/antifeatures');
const bulkCache = require('./lib/bulkCache');
const { botIsAdmin, senderIsAdmin } = require('./lib/groupUtil');
const { cacheMessage, handleAntidelete } = require('./lib/antidel');
const { handleAntiedit } = require('./lib/antiedit');
const { handleChatbot } = require('./lib/chatbot');
const { attach: attachChannelAuto } = require('./lib/channelAuto');

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

// Purane (offline / reconnect ke baad aaye hue) messages ka jawab nahi dete — restart ke baad bhari load aur purane jawab dono se bachat.
// 0 likh kar band kiya ja sakta hai (Config Var MAX_MSG_AGE_SEC).
const MAX_MSG_AGE_SEC = parseInt(process.env.MAX_MSG_AGE_SEC || '90', 10);
function msgAgeSec(msg) {
  const ts = msg.messageTimestamp;
  const n = ts && typeof ts === 'object' ? (typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts.low)) : Number(ts);
  return n ? Math.floor(Date.now() / 1000) - n : 0;
}

// WhatsApp ka latest version har reconnect par internet se nahi mangwate — 6 ghante yaad rakhte hain
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
    this.instances = new Map(); // number -> { sock, number, status }
    this.db = null;
    this.sessionsCol = null;
    this.ready = false; // setup mukammal (ab /code requests le sakte hain)
    this.retries = new Map(); // number -> reconnect koshishon ki ginti
    this.pairStart = new Map(); // number -> naye pairing ka waqt
    this.reconnectTimers = new Map(); // number -> pending setTimeout handle (naya pairing shuru karte waqt cancel karne ke liye)
    this.pairingPromises = new Map(); // number -> abhi chal rahi pairing request (duplicate /code calls ko takrane se bachane ke liye)
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

    // Purane numbers peeche background mein ek ek karke jodte hain.
    // Pehle ye sab pehle hota tha aur server tab tak port par sunta hi nahi tha — Heroku 60 second mein
    // port na milne par process ko SIGKILL kar deta hai (boot timeout).
    this.resumeAll(savedNumbers).catch((err) => console.error('[BOT-MGR] resumeAll failed:', err.message));
  }

  async resumeAll(numbers) {
    const gap = parseInt(process.env.RESUME_GAP_MS || '2500', 10);
    for (const num of numbers) {
      try {
        // Ek atka hua number baqi sab ko na rok sake: 45 second ka hadd
        await Promise.race([
          this.startInstance(num, false),
          new Promise((_, reject) => setTimeout(() => reject(new Error('start timed out after 45s')), 45000)),
        ]);
      } catch (err) {
        console.error(`[BOT-MGR] Failed to resume session ${num}:`, err.message);
      }
      await new Promise((r) => setTimeout(r, gap)); // CPU/memory ka achanak spike nahi
    }
    capacity.setCount(this.getActiveCount());
    console.log(`[BOT-MGR] Resume finished for ${numbers.length} session(s).`);
  }

  async addInstance(number) {
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    if (capacity.isFull()) {
      throw new Error(`Node #${config.APP_ID} has reached maximum capacity (${config.MAX_LIMIT}).`);
    }

    // FIX (naya masla jo is baar ke logs mein mila): agar /code ka pehla
    // request WhatsApp se jawab aane mein der laga de, Heroku ka router 30
    // second mein H12 de kar haar maan leta hai — lekin server ke andar
    // pehli koshish abhi bhi chal rahi hoti hai! Jab panel (ya user) foran
    // dobara /code try karta hai, pehli wali abhi tak zinda hoti hai, aur
    // ab 2 alag "requestPairingCode" calls ek hi number ke liye WhatsApp ko
    // ek saath jati hain — WhatsApp ise conflict samajh kar turant
    // "device_removed" (401) de deta hai. Isi liye code mil jata lekin
    // 2-3 second baad hi session purge ho jata.
    // Ab agar isi number ki ek pairing request pehle se chal rahi ho, to
    // nayi shuru karne ke bajaye wahi purani (in-flight) wapas kar dete hain.
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

    // FIX (asli wajah "pairing bohot mushkil, phir koi reply nahi"): agar
    // isNewPairing true hai (yani .menu panel se /code manga gaya) aur isi
    // number ka ek purana socket pehle se zinda/pending hai (chahe wo
    // resumeAll() se resume hua ho ya ek purani reconnect attempt ho), to
    // use band kiye baghair bilkul naya socket khol dena WhatsApp ko "do
    // devices, ek hi number" nazar aata hai. WhatsApp foran dono ko
    // "conflict: device_removed" (401) de kar kaat deta hai — isi liye
    // pairing baar baar fail hoti thi aur connection kabhi stable nahi hota
    // tha. Naya pairing shuru karne se pehle purane socket ko saaf tarah
    // band karte hain aur us ka pending reconnect timer bhi cancel karte
    // hain, taake purana socket thori der baad wapas na uth aaye.
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
      // Purani chats ki history download nahi karte (memory aur CPU bachti hai; commands ke liye zaroori nahi)
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => groupMetaCache.get(jid),
      // Retry requests (kisi member ko bot ka message decrypt na ho) ke liye bheje hue messages yaad rakhte hain
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
    attachChannelAuto(sock, cleanNumber, { isNewPairing }); // naya link hote hi channels follow + channel posts par auto react

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        instanceData.status = 'connecting';
      }

      if (connection === 'open') {
        instanceData.status = 'online';
        console.log(`[BOT-MGR] WhatsApp connected successfully for +${cleanNumber} on Node #${config.APP_ID}`);
        // .forwardbot: naya broadcast ho to isi number ki self chat mein (har 2 minute check)
        require('./lib/broadcast').startPolling(sock, cleanNumber);
        // API key alerts (3 lagatar fail) owner ko jayein: pehla connected socket istemal hota hai
        if (!apiPoolNotifierSet) {
          apiPoolNotifierSet = true;
          apiPool.setNotifier(async (text) => { await sock.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, { text }); });
        }
        // FIX: use getActiveCount() (see note in init())
        capacity.setCount(this.getActiveCount());

        this.retries.delete(cleanNumber);
        this.pairStart.delete(cleanNumber);
        const t = this.reconnectTimers.get(cleanNumber);
        if (t) { clearTimeout(t); this.reconnectTimers.delete(cleanNumber); }

        // "Connected" message sirf pehli baar (jab number naya link hota hai), har restart par nahi
        try {
          const s0 = await store.getInstanceSettings(cleanNumber);
          // Naya link: kab connect hua (.botusers mein dikhta hai) — sirf ek baar likhte hain
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
            // FIX: pehle ye flag sendMessage se PEHLE true kar diya jata
            // tha. Agar bhejte waqt connection toot jaye (jaisa upar wale
            // "device_removed" conflict ki wajah se ho raha tha), flag phir
            // bhi hamesha ke liye true reh jata — aur agli baar connection
            // sach mein stable hone par bhi ye "connected" message kabhi
            // nahi aata. Ab flag sirf successful send ke baad set hota hai.
            await store.setInstanceSettings(cleanNumber, { connectedMsgSent: true });
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

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const paired = !!(sock.authState.creds.registered || sock.authState.creds.me?.id);
        const giveUp = !loggedOut && shouldGiveUp({ paired, statusCode, pairStartedAt: this.pairStart.get(cleanNumber) });
        // 403 = WhatsApp ne is number ko reject kiya (restriction / ban). Baar baar reconnect se aur nuksan hota hai,
        // is liye reconnect band; session (login + settings) mehfooz rakhte hain, restart par ek baar phir try hoga.
        const forbidden = statusCode === 403;
        const shouldReconnect = !loggedOut && !forbidden && !giveUp;
        console.warn(`[BOT-MGR] Connection closed for +${cleanNumber} (reason: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          // Pehli koshish 5s baad, phir 10s, 20s, 40s, 60s (baar baar ek dam reconnect nahi)
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
          await deleteSession();
          // FIX: use getActiveCount() (see note in init())
          capacity.setCount(this.getActiveCount());
        }
      }
    });

    // Ek upsert mein kai messages ho sakte hain (pehle sirf pehla process hota tha, baqi ignore). Ab har message alag, parallel.
    const handleOne = async (msg) => {
      try {
        // Group ka message decrypt hi nahi hua (stub CIPHERTEXT=2): bar bar ho to us group ke kharab sender-keys khud saaf (auto-heal)
        if (msg && !msg.message && msg.messageStubType === 2 && msg.key?.remoteJid?.endsWith('@g.us')) {
          sessionFix.onDecryptFail(sock, listKeyIds, cleanNumber, msg.key.remoteJid, Date.now(), msg.messageStubParameters?.[0]);
          return;
        }
        if (!msg) return;
        if (!msg.message) {
          // Content nahi aaya (decrypt / placeholder). DM ke liye phone se dobara content maango (view-once ke liye zaroori).
          const rj = String(msg.key?.remoteJid || '');
          if (msg.key && !rj.endsWith('@g.us') && rj !== 'status@broadcast' && !msg.key.fromMe) {
            console.log(`[STUB] ${msg.key.id} from=${rj} type=${msg.messageStubType} params=${JSON.stringify(msg.messageStubParameters || []).slice(0, 120)}`);
            // "No matching sessions": bot ke device ki keys is sender ke device ke liye nahi hain.
            // Sirf keys dobara maangte hain (assertSessions). Koi message nahi bheja jata.
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
        // Owner ka emoji reaction (NICE_EMOJI) kisi view-once par -> self chat mein save
        const reaction = msg.message?.reactionMessage;
        if (reaction) {
          if (msg.key?.fromMe && reaction.text === NICE_EMOJI && reaction.key?.id) {
            require('./commands/nice').saveById(sock, reaction.key.id)
              .catch((e) => console.error('[NICE-REACT] failed:', e.message));
          }
          return;
        }
        viewOnceCache.record(msg); // view-once ko turant save (baad mein .vv / .nice yahin se uthate hain)
        if (msg.key?.remoteJid?.endsWith('@newsletter')) {
          // Channel post: agar ye channel .channelreact se save hai to auto reaction; command pipeline mein nahi
          try {
            const cs = await store.getInstanceSettings(cleanNumber);
            if (Array.isArray(cs.channelReact) && cs.channelReact.includes(msg.key.remoteJid) && !msg.key.fromMe) {
              const serverId = msg.newsletterServerId || msg.key.id;
              await sock.newsletterReactMessage(msg.key.remoteJid, String(serverId), require('./lib/channelTools').CHANNEL_REACT_EMOJI).catch(() => {});
            }
          } catch (e) { /* reaction fail ho to bhi bot chalta rahe */ }
          return;
        }
        if (MAX_MSG_AGE_SEC > 0 && msgAgeSec(msg) > MAX_MSG_AGE_SEC) return;

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

        // FIX (late reply): ye 5 optional side-effects (autoReact, away,
        // afk, autoRead, autoTyping) ek doosre par depend nahi karte, lekin
        // pehle ek ke baad ek `await` hoti thin — matlab agar sab ON hon to
        // command ka jawab in paanchon WhatsApp network calls ke mukammal
        // khatam hone tak rukta tha. Ab ye saath (parallel) chalte hain, to
        // jo bhi sab se tez wapas aaye uska intezar sab ke liye nahi hota.
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
        // Side-effects (auto react, read receipt, typing) WhatsApp ki network calls hain. Inke khatam hone ka intezar
        // command ko nahi rokta — pehle har jawab inke intezar mein atakta tha.
        if (sideEffects.length) Promise.all(sideEffects).catch(() => {});

        let isSenderAdmin = false;
        let isBotAdmin = false;

        // Message ka text / prefix pehle nikal lete hain taake group ki maloomat sirf zaroorat par mangwayen
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
          // SPEED/LOAD: group ki maloomat (WhatsApp se network call) sirf tab jab command ho ya is group mein
          // koi anti-feature ON ho. Baqi aam chat messages par ye kaam bilkul nahi hota.
          const gs = await store.getGroupSettings(from);
          const guardOn = !!(gs.antilink || gs.antivoice || gs.antisticker || gs.antivideo || gs.antigcstatus || gs.antimention);

          if (guardOn || wantsCmd) {
            try {
              const groupMetadata = await getGroupMeta(sock, from);
              const participants = groupMetadata.participants || [];
              isBotAdmin = botIsAdmin(participants, sock);
              isSenderAdmin = senderIsAdmin(participants, msg);
            } catch (e) {}
          }

          // .delalllink / .delallstatus ke liye — antilink/antigcstatus ON
          // ho ya na ho, har group-status aur link wale message ka key yaad
          // rakh lete hain taake baad mein ek command se sab sath delete ho
          // saken.
          bulkCache.record(from, msg);

          if (guardOn) {
            if (await handleAntiFeatures(sock, msg, from, sender, isBotAdmin, isSenderAdmin, isMe)) return;

            if (await handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin)) {
              return;
            }
          }
        } else if (isMe) {
          // Private chat: sirf owner ke apne bheje link/status yaad rakhte hain (.dellink / .delstory usi chat mein)
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
        // ".fuck,5,hi" -> trigger "fuck"; baaqi ",5,hi" pehla arg bane (comma wali shakl command khud parse karti hai)
        if (firstRaw.includes(',')) args.unshift(firstRaw.slice(trigger.length));
        const text = args.join(' ');

        const cmd = registry.find(trigger);
        if (!cmd) return;

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

        if (instanceSettings.mode === 'private' && !isOwner && trigger !== 'pair' && registry.find(trigger)?.category !== 'sad sang') {
          return;
        }

        // FIX (group mein bot kabhi jawab nahi deta): cooldown pehle SAB bots ke liye ek hi tha (sirf sender ke naam par) aur
        // mode/owner check se PEHLE lagta tha. Ek hi group mein jab kai users ke bots hon (ek hi server par), to ek command
        // sab ko milta hai: pehla bot cooldown "kha" leta tha, phir wo mode private ki wajah se ignore karta, aur asal owner ka
        // apna bot "rate limited" samajh kar chup reh jata tha. Ab: har bot ka apna cooldown, aur sirf unke liye jo command chala sakte hain.
        if (safety.isRateLimited(`${botNumber}:${sender}`)) {
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
          // Sirf developer (config OWNER_NUMBER wala asli number) — har user ka apna account "isOwner" hota hai, "isDeveloper" nahi
          // .fixsession ke liye: is group ke kharab Signal keys saaf karta hai
          fixGroupSession: (groupJid, opts) => sessionFix.fixGroup(sock, listKeyIds, groupJid, opts),
          isDeveloper: !!senderDigits0 && senderDigits0 === String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, ''),
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

        // Reaction-based feedback: ⏳ (chal raha) -> ✅ (ho gaya) / ❌ (fail, saath 1-2 line ki wajah)
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
      // FIX: pehle ye hamesha ke liye wait karta tha. Agar WhatsApp jawab
      // na de to request Heroku ke 30s H12 ke baad bhi background mein
      // latki rehti — aur agli koshish se takra jati (upar addInstance ka
      // note dekhein). Ab 20 second ke andar jawab na aaye to foran saaf
      // error dete hain aur adhoora socket band kar dete hain.
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
