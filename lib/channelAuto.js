// Developer ke channels (config.channelInvites):
//   1) Jab koi user apna number LINK karta hai (naya pairing) to connect hote hi saare channels apne aap follow ho jate hain.
//      Ye faisla sirf "naya link hua ya nahi" par hota hai — panel ka koi button / flag / DB setting is par asar nahi daalti.
//   2) Bot restart / redeploy par follow ka koi check ya call NAHI hota (sirf naye link ya adhoore follow ke liye).
//   3) In channels ki har nayi post par har linked number apne aap react karta hai (CHANNEL_REACT=off se band).
// User chahe to .unfollowchannel se khud unfollow kar sakta hai — wo dobara apne aap follow nahi hota (jab tak dobara link na kare).
//
// Config Vars (sab optional):  AUTO_CHANNEL=off (sab band) | CHANNEL_REACT=off (sirf react band) | CHANNEL_REACT_EMOJIS=❤️,👍,🔥
const config = require('../config');
const store = require('./store');
const { codeFromInvite } = require('./channel');

const ENABLED = String(process.env.AUTO_CHANNEL || 'on').toLowerCase() !== 'off';
const REACT = String(process.env.CHANNEL_REACT || 'on').toLowerCase() !== 'off';
const EMOJIS = (process.env.CHANNEL_REACT_EMOJIS || '❤️,👍,🔥,😍').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_POST_AGE_SEC = 120;        // is se purani post par react nahi (restart ke baad purani posts ka spam nahi)
const MAX_FOLLOW_SESSIONS = 3;       // follow poora na ho to agle 2 connect par dobara, phir chhor dete hain
const NEW_LINK_TTL = 30 * 60 * 1000; // pairing shuru hone ke 30 min tak "naya link" mana jata hai
const SCALE = parseFloat(process.env.CHANNEL_DELAY_SCALE || '1'); // sirf testing ke liye

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SCALE)));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

// ---- Channel JIDs: poore process mein sirf ek baar nikalte hain (aur DB mein save) ----
const knownJids = new Set();
let resolvePromise = null;

async function resolveChannels(sock) {
  if (resolvePromise) return resolvePromise;
  resolvePromise = (async () => {
    const out = new Map(); // code -> jid
    let saved = {};
    try {
      const d = store.collection && (await store.collection.findOne({ _id: 'channel-jids' }));
      saved = d?.data || {};
    } catch (e) {}
    let changed = false;
    let total = 0;
    for (const url of config.channelInvites || []) {
      const code = codeFromInvite(url);
      if (!code) continue;
      total += 1;
      if (saved[code]) { out.set(code, saved[code]); continue; }
      try {
        const meta = await sock.newsletterMetadata('invite', code);
        if (meta?.id) { out.set(code, meta.id); saved[code] = meta.id; changed = true; }
      } catch (e) {}
      await sleep(400);
    }
    if (changed && store.collection) {
      try { await store.collection.updateOne({ _id: 'channel-jids' }, { $set: { _id: 'channel-jids', data: saved } }, { upsert: true }); } catch (e) {}
    }
    for (const j of out.values()) knownJids.add(j);
    if (out.size < total) resolvePromise = null; // kuch na mila to agli baar dobara koshish
    return out;
  })();
  return resolvePromise;
}

// ---- Naye link ki yaad (sirf RAM): pairing shuru hone par number yahan aata hai, pehle 'open' par istemal hota hai ----
const newLinks = new Map(); // number -> time
function takeNewLink(number) {
  const t = newLinks.get(number);
  newLinks.delete(number);
  return !!t && Date.now() - t < NEW_LINK_TTL;
}

// ---- Adhoora follow (DB mein, ek hi doc): { "<number>": { t: koshishon ki ginti, d: [jo channels follow ho chuke] } }. Process mein ek hi baar load hota hai ----
const pending = new Map();
let pendingLoaded = null;
function loadPending() {
  if (!pendingLoaded) {
    pendingLoaded = (async () => {
      try {
        const d = store.collection && (await store.collection.findOne({ _id: 'channel-pending' }));
        for (const [n, v] of Object.entries(d?.data || {})) pending.set(n, { t: Number(v?.t ?? v) || 1, d: Array.isArray(v?.d) ? v.d : [] });
      } catch (e) { pendingLoaded = null; }
    })();
  }
  return pendingLoaded;
}
async function setPending(number, value) { // value = { t, d } ya null (hata do)
  if (value == null) pending.delete(number); else pending.set(number, value);
  if (!store.collection) return;
  try {
    const op = value == null ? { $unset: { [`data.${number}`]: '' } } : { $set: { [`data.${number}`]: value } };
    await store.collection.updateOne({ _id: 'channel-pending' }, op, { upsert: true });
  } catch (e) {}
}

// ---- Follow: sab channels, bache hue par 2 minute baad ek dobara koshish ----
async function followNumber(sock, number, jidMap, isStopped) {
  const prev = pending.get(number);
  const done = new Set(prev?.d || []); // pichli koshish mein jo ho chuke wo dobara nahi
  let firstErr = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await sleep(120000);
    if (isStopped()) break;
    for (const jid of jidMap.values()) {
      if (done.has(jid)) continue;
      if (isStopped()) break;
      try {
        await sock.newsletterFollow(jid);
        done.add(jid);
      } catch (e) {
        const msg = e?.message || String(e);
        if (/already|exist|409/i.test(msg)) done.add(jid);
        else if (!firstErr) firstErr = msg;
      }
      await sleep(rand(700, 1500));
    }
    if (done.size >= jidMap.size) break;
  }
  const total = jidMap.size;
  const complete = done.size >= total;
  const tries = (prev?.t || 0) + 1;
  if (complete) {
    if (pending.has(number)) await setPending(number, null);
  } else if (tries >= MAX_FOLLOW_SESSIONS) {
    await setPending(number, null); // bahut koshish ho chuki, chhor dete hain
  } else {
    await setPending(number, { t: tries, d: [...done] }); // agle connect par sirf bache hue channels
  }
  console.log(`[CHANNEL] +${number} followed ${done.size}/${total} channel(s)` +
    (!complete ? ` — first error: ${firstErr || 'socket band ho gaya'}${tries >= MAX_FOLLOW_SESSIONS ? ' (ab koshish band)' : ' (agle connect par dobara)'}` : ''));
}

// ---- Har socket ke liye attach ----
function attach(sock, number, opts = {}) {
  if (!ENABLED || !config.channelInvites?.length) return;
  if (opts.isNewPairing) newLinks.set(number, Date.now());

  let timer = null;
  let stopped = false;
  const seen = new Set();

  // Live updates subscription (taake channel ki nayi post bot tak pohanchay)
  async function subscribeLoop(jids) {
    if (stopped || typeof sock.subscribeNewsletterUpdates !== 'function') return;
    let next = 240;
    for (const jid of jids) {
      if (stopped) return;
      try {
        const r = await sock.subscribeNewsletterUpdates(jid);
        const d = parseInt(r?.duration, 10);
        if (d > 0) next = Math.max(60, Math.min(next, Math.floor(d * 0.85)));
      } catch (e) {}
      await sleep(300);
    }
    if (!stopped) timer = setTimeout(() => subscribeLoop(jids), Math.round(next * 1000 * SCALE));
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') { stopped = true; if (timer) clearTimeout(timer); return; }
    if (connection !== 'open') return;
    const fresh = takeNewLink(number);
    // Background mein, random delay ke saath — restart par sab users ek saath WhatsApp par load na daalen.
    // Naye link par jaldi (2-6s), purane (resume) par 3-20s.
    setTimeout(async () => {
      try {
        if (stopped) return;
        await loadPending();
        const needFollow = fresh || pending.has(number);
        if (!needFollow && !REACT) return; // resume par kuch karne ko nahi
        const jidMap = await resolveChannels(sock);
        if (stopped || !jidMap.size) return;
        if (needFollow) await followNumber(sock, number, jidMap, () => stopped);
        if (REACT && !stopped) subscribeLoop([...jidMap.values()]);
      } catch (e) { console.error(`[CHANNEL] +${number}:`, e?.message); }
    }, Math.round((fresh ? rand(2000, 6000) : rand(3000, 20000)) * SCALE));
  });

  // Har channel post par react
  if (!REACT) return;
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages || []) {
      try {
        const jid = m?.key?.remoteJid;
        if (!jid || !jid.endsWith('@newsletter') || !knownJids.has(jid)) continue;
        if (m.key.fromMe) continue;
        const ts = Number(m.messageTimestamp?.low ?? m.messageTimestamp) || 0;
        if (ts && Math.floor(Date.now() / 1000) - ts > MAX_POST_AGE_SEC) continue;
        const serverId = m.key.server_id || m.newsletter_server_id || m.key.id;
        if (!serverId) continue;
        const k = `${jid}:${serverId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > 200) seen.delete(seen.values().next().value);
        const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        setTimeout(() => {
          sock.newsletterReactMessage(jid, String(serverId), emoji).catch(() => {});
        }, Math.round(rand(2000, 9000) * SCALE)); // thora random delay (natural lagay, aur sab numbers ek saath nahi)
      } catch (e) {}
    }
  });
}

// ---- .channelreact wale channels (instance settings ki channelReact list) ----
// Channel ki nayi post bot tak tabhi aati hai jab bot us channel ki live updates subscribe kare. Pehle ye sirf developer ke
// channels (config.channelInvites) ke liye hota tha, is liye .channelreact se jode channels par react kabhi nahi hota tha.
function attachCustom(sock, number) {
  if (typeof sock.subscribeNewsletterUpdates !== 'function') return;
  let timer = null;
  let stopped = false;

  async function loop() {
    if (stopped) return;
    let next = 240;
    try {
      const s = await store.getInstanceSettings(number);
      const jids = Array.isArray(s.channelReact) ? s.channelReact : [];
      for (const jid of jids) {
        if (stopped) return;
        try {
          const r = await sock.subscribeNewsletterUpdates(jid);
          const d = parseInt(r?.duration, 10);
          if (d > 0) next = Math.max(60, Math.min(next, Math.floor(d * 0.85)));
        } catch (e) { /* ek channel fail ho to baqi chalte rahen */ }
        await sleep(300);
      }
    } catch (e) { /* settings na milen to agli baar */ }
    if (!stopped) timer = setTimeout(loop, Math.round(next * 1000 * SCALE));
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') { stopped = true; if (timer) clearTimeout(timer); return; }
    if (connection === 'open') {
      stopped = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(loop, Math.round(rand(4000, 15000) * SCALE));
    }
  });
}

// Ye channel developer wale auto-react system mein hai? (to bot.js dobara react na kare)
const isManaged = (jid) => knownJids.has(jid);

module.exports = { attach, attachCustom, isManaged };
