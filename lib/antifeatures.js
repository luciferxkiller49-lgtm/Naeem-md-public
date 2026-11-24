// Group anti-features: antivoice, antisticker, antivideo, antigcstatus, antimention
// Har ek ke 4 modes: off | delete | warn | kick
const store = require('./store');
const { removeAndNotify, targetOf } = require('./removeNotice');
const deleteGuard = require('./deleteGuard');
const { warn, userOf } = require('./warnNotice');

const MAX_WARNINGS = 3;
const warnings = new Map();

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

// NOTE: WhatsApp ke protobuf message objects par har field pehle se `null` ke taur par maujood hota hai,
// is liye `key in m` HAR message par true aata hai (isi se har message delete ho raha tha). Hamesha `!!m[key]` se jaanchein.
const MENTION_KEYS = ['groupStatusMentionMessage', 'statusMentionMessage'];
const GCSTATUS_KEYS = ['groupStatusMessageV2', 'groupStatusMessage'];

// field -> { label (message mein), detect(m) }
const FEATURES = {
  antivoice: { label: 'voice notes', detect: (m) => !!m.audioMessage?.ptt },
  antisticker: { label: 'stickers', detect: (m) => !!m.stickerMessage },
  antivideo: { label: 'videos', detect: (m) => !!(m.videoMessage || m.ptvMessage) },
  antipic: { label: 'images', detect: (m) => !!m.imageMessage },
  // Group STORY (group status) — sirf wahi
  antigcstatus: { label: 'group status posts', detect: (m) => !MENTION_KEYS.some((k) => !!m[k]) && GCSTATUS_KEYS.some((k) => !!m[k]) },
  // Status jo group ko MENTION karta hai — story nahi
  antimention: {
    label: 'status mentions',
    detect: (m) => MENTION_KEYS.some((k) => !!m[k]) || m.protocolMessage?.type === 25 || m.protocolMessage?.type === 'STATUS_MENTION_MESSAGE',
  },
};

// Delete ke baad "⚠️ @user, ... ARE NOT ALLOWED IN THIS GROUP." warning wapis hai, lekin throttled (WARN_COOLDOWN_SEC,
// default 20s) taake 100 messages par 100 warnings na jayen. Kick/3-warning par member nikalne ka message wajah batata hai.
async function act(sock, msg, from, sender, mode, label, field) {
  // Ek hi process mein doosre bot ne pehle hi delete kar diya to chhor do
  if (deleteGuard.has(msg.key.id)) return;
  try {
    await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: msg.key.participant || msg.key.participantAlt } });
    deleteGuard.mark(msg.key.id); // sirf kamyab delete par hi claim (fail ho to doosra bot try kare)
    console.log(`[${field}] deleted ${msg.key.id} from ${sender} in ${from} (mode ${mode})`);
  } catch (e) {
    // Delete fail: warning/kick bhi nahi (pehle warning chali jati thi aur message wahin rehta tha)
    console.error(`[${field}] delete failed:`, e.message);
    if (mode !== 'kick') return; // kick mode: delete na ho (jaise group status) to bhi member ko nikalo
  }

  if (mode === 'kick') {
    const ok = await removeAndNotify(sock, from, targetOf(msg, sender), `group mein ${label} bhejna mana hai`);
    console.log(`[${field}] kick ${sender}: ${ok ? 'ok' : 'FAILED (target admin ya bot admin nahi)'}`);
  } else if (mode === 'warn') {
    const k = `${userOf(sock.user?.id)}:${from}:${sender}:${field}`; // har bot ki apni ginti
    const count = (warnings.get(k) || 0) + 1;
    if (count >= MAX_WARNINGS) {
      warnings.delete(k);
      await removeAndNotify(sock, from, targetOf(msg, sender), `group mein baar baar ${label} bhejna mana hai (3 warnings)`);
    } else {
      warnings.set(k, count);
      await warn(sock, from, sender, `${label.toUpperCase()} ARE NOT ALLOWED IN THIS GROUP. (${count}/${MAX_WARNINGS})`);
    }
  } else {
    await warn(sock, from, sender, `${label.toUpperCase()} ARE NOT ALLOWED IN THIS GROUP.`);
  }
}

/** true return karne ka matlab: message handle ho gaya (aage processing nahi) */
async function handleAntiFeatures(sock, msg, from, sender, isBotAdmin, isSenderAdmin, isMe) {
  if (isMe || isSenderAdmin || !msg.message) return false;
  const gs = await store.getGroupSettings(from);
  const m = unwrap(msg.message);

  // TEMP DIAGNOSTIC (antigcstatus "doosre bot ka status delete nahi karta" bug
  // dhoondne ke liye): jab is group mein antigcstatus ON ho aur message
  // GCSTATUS_KEYS/MENTION_KEYS se match na ho, to message ki top-level keys
  // log karte hain — taake agli baar "doosre bot" wala status post aaye to
  // uska asal structure dikh jaye. Root cause mil jaane ke baad ye block
  // hata dena.
  if (gs.antigcstatus && gs.antigcstatus !== 'off') {
    const known = [...GCSTATUS_KEYS, ...MENTION_KEYS];
    if (!known.some((k) => !!m[k])) {
      const keys = Object.keys(m);
      if (keys.length) console.log(`[GCSTATUS-DEBUG] group=${from} sender=${sender} keys=[${keys.join(', ')}]`);
    }
  }

  for (const [field, f] of Object.entries(FEATURES)) {
    const mode = gs[field];
    if (!mode || mode === 'off') continue;
    if (!f.detect(m)) continue;
    if (!isBotAdmin) return false; // bot admin nahi to kuch kar nahi sakta
    await act(sock, msg, from, sender, mode, f.label, field);
    return true;
  }
  return false;
}

module.exports = { handleAntiFeatures, FEATURES };
