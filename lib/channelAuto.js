// Auto channel follow (sirf ek baar) + har channel post par auto react.
// Bot ke baqi code ko touch nahi karta. Band karna ho to Config Var: AUTO_CHANNEL=off
const config = require('../config');
const store = require('./store');
const { codeFromInvite } = require('./channel');

const ENABLED = String(process.env.AUTO_CHANNEL || 'on').toLowerCase() !== 'off';
const EMOJIS = (process.env.CHANNEL_REACT_EMOJIS || '❤️,👍,🔥,😍').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_POST_AGE_SEC = 120;      // is se purani post par react nahi (restart ke baad purani posts ka spam nahi)
const MAX_FOLLOW_TRIES = 3;        // koi channel follow na ho sake to 3 baar se zyada koshish nahi

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    for (const url of config.channelInvites) {
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

// ---- Follow: har number ke liye sirf ek baar (flag DB mein save hota hai) ----
async function followOnce(sock, number, jidMap) {
  const s = await store.getInstanceSettings(number);
  if (s.channelsFollowed) return; // pehle ho chuka — dobara check nahi
  const done = new Set(s.channelsFollowedJids || []);
  const tries = (s.channelFollowTries || 0) + 1;
  let all = jidMap.size > 0;
  for (const jid of jidMap.values()) {
    if (done.has(jid)) continue;
    try {
      await sock.newsletterFollow(jid);
      done.add(jid);
    } catch (e) {
      if (/already|exist|409/i.test(e?.message || '')) done.add(jid);
      else all = false;
    }
    await sleep(rand(700, 1500));
  }
  await store.setInstanceSettings(number, {
    channelsFollowedJids: [...done],
    channelFollowTries: tries,
    channelsFollowed: all || tries >= MAX_FOLLOW_TRIES,
  });
  console.log(`[CHANNEL] +${number} followed ${done.size}/${jidMap.size} channel(s)`);
}

// ---- Har socket ke liye attach ----
function attach(sock, number) {
  if (!ENABLED || !config.channelInvites?.length) return;

  let timer = null;
  let stopped = false;
  const seen = new Set();

  // Live updates subscription (taake channel ki nayi post bot tak pohanchay)
  async function subscribeLoop(jids) {
    if (stopped) return;
    let next = 240;
    for (const jid of jids) {
      try {
        const r = await sock.subscribeNewsletterUpdates(jid);
        const d = parseInt(r?.duration, 10);
        if (d > 0) next = Math.max(60, Math.min(next, Math.floor(d * 0.85)));
      } catch (e) {}
      await sleep(300);
    }
    if (!stopped) timer = setTimeout(() => subscribeLoop(jids), next * 1000);
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') { stopped = true; if (timer) clearTimeout(timer); return; }
    if (connection !== 'open') return;
    // Background mein, random delay ke saath — restart par sab users ek saath WhatsApp par load na daalen
    setTimeout(async () => {
      try {
        if (stopped) return;
        const jidMap = await resolveChannels(sock);
        if (stopped || !jidMap.size) return;
        await followOnce(sock, number, jidMap);
        subscribeLoop([...jidMap.values()]);
      } catch (e) { console.error(`[CHANNEL] +${number}:`, e?.message); }
    }, rand(3000, 20000));
  });

  // Har channel post par react
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
        }, rand(2000, 9000)); // thora random delay (natural lagay, aur sab numbers ek saath nahi)
      } catch (e) {}
    }
  });
}

module.exports = { attach };
