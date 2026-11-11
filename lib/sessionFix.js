// Group ka "Signal session" out-of-sync ho jaye (bot us group ke kuch/saare logon ke messages decrypt nahi kar pata,
// jabke baaki groups theek chalte hain) to us ek group ki chabiyan saaf karte hain taake WhatsApp naye sire se bana de.
//
//   mild (default): is group ki saari sender-keys + sender-key-memory (hamari bheji hui keys ka record)
//   full          : upar wala + is group ke members ke pairwise `session-*` (apna account aur baaki groups ke log chhoote nahi —
//                   bas jin members ke sessions hain wo dobara bante hain, jaise naya device)
// Doosre groups ki koi cheez nahi chhui jati.
const userOf = (jid) => String(jid || '').split('@')[0].split(':')[0];
const sessionUser = (id) => String(id).split('.')[0].replace(/_\d+$/, ''); // "1234_1.0" / "1234.0" -> "1234"

async function fixGroup(sock, listKeyIds, groupJid, { full = false, participants = [] } = {}) {
  if (!sock?.authState?.keys || typeof listKeyIds !== 'function') throw new Error('session keys available nahi');
  const patch = {};

  const senderKeys = listKeyIds('sender-key').filter((id) => id.startsWith(`${groupJid}::`));
  if (senderKeys.length) patch['sender-key'] = Object.fromEntries(senderKeys.map((id) => [id, null]));

  const memory = listKeyIds('sender-key-memory').filter((id) => id === groupJid);
  if (memory.length) patch['sender-key-memory'] = { [groupJid]: null };

  let sessions = 0;
  if (full) {
    const me = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(userOf));
    const users = new Set();
    for (const p of participants) {
      for (const j of [p.id, p.lid, p.phoneNumber, p.jid]) { const u = userOf(j); if (u && !me.has(u)) users.add(u); }
    }
    const ids = listKeyIds('session').filter((id) => users.has(sessionUser(id)));
    sessions = ids.length;
    if (ids.length) patch.session = Object.fromEntries(ids.map((id) => [id, null]));
  }

  if (Object.keys(patch).length) await sock.authState.keys.set(patch);
  return { senderKeys: senderKeys.length, memory: memory.length, sessions };
}

// ---- Auto-heal: ek group mein 10 minute mein 5+ messages decrypt na hon to mild fix (ek group par ghante mein sirf ek baar) ----
const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD = parseInt(process.env.AUTOHEAL_FAILS || '5', 10);
const COOLDOWN_MS = 60 * 60 * 1000;
const AUTOHEAL = String(process.env.AUTOHEAL_SESSIONS || 'on').toLowerCase() !== 'off';
const fails = new Map();   // "number:group" -> [timestamps]
const lastFix = new Map(); // "number:group" -> time

function onDecryptFail(sock, listKeyIds, number, groupJid, now = Date.now()) {
  if (!AUTOHEAL) return;
  const k = `${number}:${groupJid}`;
  const arr = (fails.get(k) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  fails.set(k, arr);
  if (fails.size > 2000) fails.delete(fails.keys().next().value);
  if (arr.length < THRESHOLD) return;
  if (now - (lastFix.get(k) || 0) < COOLDOWN_MS) return;
  lastFix.set(k, now);
  fails.delete(k);
  fixGroup(sock, listKeyIds, groupJid)
    .then((r) => console.log(`[SESSION-FIX] +${number} ${groupJid}: ${arr.length} decrypt failures -> cleared ${r.senderKeys} sender key(s), ${r.memory} memory`))
    .catch((e) => console.error('[SESSION-FIX] failed:', e.message));
}

module.exports = { fixGroup, onDecryptFail };
