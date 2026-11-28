// Sender ka asli phone number nikalna (LID ho ya number, dono tarah ke chat mein).
// Baileys 7 mein group sender ka number `participantAlt`, DM ka `remoteJidAlt` mein hota hai
// (purane code mein `participantPn` use ho raha tha jo ab nahi aata).
const userPart = (jid) => String(jid || '').split('@')[0].split(':')[0];
const digitsOf = (jid) => userPart(jid).replace(/[^0-9]/g, '');
const isPN = (jid) => /@s\.whatsapp\.net$/.test(String(jid || ''));
const isLID = (jid) => /@lid$/.test(String(jid || ''));

const found = new Map(); // lid user -> phone digits (hamesha)
const missed = new Map(); // lid user -> time (5 min tak dobara nahi poochte)
const MISS_TTL = 5 * 60 * 1000;

function remember(map, key, val) {
  map.set(key, val);
  if (map.size > 3000) map.delete(map.keys().next().value);
}

async function resolvePN(sock, jid) {
  if (!jid) return '';
  if (isPN(jid)) return digitsOf(jid);
  if (!isLID(jid)) return '';
  const u = userPart(jid);
  if (found.has(u)) return found.get(u);
  const t = missed.get(u);
  if (t && Date.now() - t < MISS_TTL) return '';
  try {
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
    const d = digitsOf(pn);
    if (d) { remember(found, u, d); return d; }
  } catch (e) { /* mapping na mile to neeche fallback */ }
  remember(missed, u, Date.now());
  return '';
}

/** Message bhejne wale ka phone number (sirf digits). Na mile to khaali string. */
async function senderPN(sock, msg) {
  const k = msg?.key || {};
  if (k.fromMe) return digitsOf(sock?.user?.id);
  const cands = [k.participantAlt, k.remoteJidAlt, k.participantPn, k.senderPn, k.participant, k.remoteJid].filter(Boolean);
  const direct = cands.find(isPN);
  if (direct) return digitsOf(direct);
  for (const c of cands) {
    const d = await resolvePN(sock, c);
    if (d) return d;
  }
  return '';
}

module.exports = { userPart, digitsOf, isPN, isLID, resolvePN, senderPN };
