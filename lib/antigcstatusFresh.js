// lib/antigcstatusFresh.js
// .antigcstatus2 — BILKUL NAYA/FRESH, purane antifeatures.js se mukammal independent.
// Maqsad: sirf TEST/ANALYZE karna — isliye har message ki poori detail console mein
// log karta hai jab tak ye is group mein ON hai.
//
// Jaan-boojh kar sirf RAM mein (restart par reset) — koi Mongo/store dependency nahi,
// taake ye poori tarah standalone/safe rahe aur kisi aur system ko chhue bina test ho sake.

const enabledGroups = new Set();

function isOn(groupId) {
  return enabledGroups.has(groupId);
}
function setOn(groupId, on) {
  if (on) enabledGroups.add(groupId);
  else enabledGroups.delete(groupId);
}

// Ephemeral/view-once wrappers ke andar se asal message nikalna
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

// WhatsApp ka asal "Group Status/Story" wrapper — yahi 2 keys isay batati hain
const REAL_STATUS_KEYS = ['groupStatusMessageV2', 'groupStatusMessage'];

/**
 * true return = message handle ho gaya (delete ho gaya / delete ki koshish hui)
 * false return = kuch nahi kiya (is group mein OFF hai, ya status hai hi nahi)
 */
async function handle(sock, msg, from, sender, isBotAdmin, isMe) {
  if (!isOn(from)) return false;
  if (isMe || !msg.message) return false;

  const m = unwrap(msg.message);
  const keys = Object.keys(m);
  const isRealStatus = REAL_STATUS_KEYS.some((k) => !!m[k]);

  // TEST LOGGING — jab tak hum isay analyze kar rahe hain, har message ki poori
  // detail chahiye: message-type keys, aur participant/participantAlt (taake
  // @lid wale senders ka asal sender-id bhi dikhe).
  console.log(
    `[GCSTATUS2] group=${from} sender=${sender} keys=[${keys.join(', ')}] ` +
    `isRealStatus=${isRealStatus} participant=${msg.key.participant || '(none)'} ` +
    `participantAlt=${msg.key.participantAlt || '(none)'}`
  );

  if (!isRealStatus) return false;

  if (!isBotAdmin) {
    console.log(`[GCSTATUS2] ${from}: status mila lekin bot admin nahi hai, delete nahi kar sakta.`);
    return false;
  }

  // @lid wale senders ke liye participant kabhi khaali hota hai — asal sender
  // participantAlt mein hota hai. Isay saaf fallback dete hain.
  const delKey = {
    remoteJid: msg.key.remoteJid,
    fromMe: false,
    id: msg.key.id,
    participant: msg.key.participant || msg.key.participantAlt,
  };

  try {
    await sock.sendMessage(from, { delete: delKey });
    console.log(`[GCSTATUS2] ${from}: deleted ${msg.key.id} from ${sender}`);
  } catch (e) {
    console.error(`[GCSTATUS2] ${from}: delete failed:`, e.message);
  }
  return true;
}

module.exports = { handle, isOn, setOn };
