// Group anti-features: antivoice, antisticker, antivideo, antigcstatus, antimention
// Har ek ke 4 modes: off | delete | warn | kick
const store = require('./store');

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

const MENTION_KEYS = ['groupStatusMentionMessage', 'statusMentionMessage'];
const GCSTATUS_KEYS = ['groupStatusMessageV2', 'groupStatusMessage'];

// field -> { label (message mein), detect(m) }
const FEATURES = {
  antivoice: { label: 'voice notes', detect: (m) => !!m.audioMessage?.ptt },
  antisticker: { label: 'stickers', detect: (m) => !!m.stickerMessage },
  antivideo: { label: 'videos', detect: (m) => !!(m.videoMessage || m.ptvMessage) },
  // Group STORY (group status) — sirf wahi
  antigcstatus: { label: 'group status posts', detect: (m) => GCSTATUS_KEYS.some((k) => k in m) },
  // Status jo group ko MENTION karta hai — story nahi
  antimention: {
    label: 'status mentions',
    detect: (m) => MENTION_KEYS.some((k) => k in m) || m.protocolMessage?.type === 25 || m.protocolMessage?.type === 'STATUS_MENTION_MESSAGE',
  },
};

// FIX: pehle har delete/warn/kick ke baad ek "⚠️ ... not allowed" ya
// "removed for sending ..." text message bhi bheja jata tha. User ne mana
// kiya hai — ab sirf message delete hota hai (aur kick mode/3-warning par
// member remove hota hai), koi reminder text nahi jata. `say()` isliye
// hata diya hai; warning ginti abhi bhi chup chaap track hoti hai taake
// 'warn' mode ka 3-strikes-kick kaam karta rahe.
async function act(sock, msg, from, sender, mode, label, field) {
  try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) { console.error(`[${field}] delete failed:`, e.message); }

  if (mode === 'kick') {
    try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch (e) {}
  } else if (mode === 'warn') {
    const k = `${from}:${sender}:${field}`;
    const count = (warnings.get(k) || 0) + 1;
    if (count >= MAX_WARNINGS) {
      warnings.delete(k);
      try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch (e) {}
    } else {
      warnings.set(k, count);
    }
  }
  // mode === 'delete' (ya koi aur): sirf delete, koi message nahi.
}

/** true return karne ka matlab: message handle ho gaya (aage processing nahi) */
async function handleAntiFeatures(sock, msg, from, sender, isBotAdmin, isSenderAdmin, isMe) {
  if (isMe || isSenderAdmin || !msg.message) return false;
  const gs = await store.getGroupSettings(from);
  const m = unwrap(msg.message);

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
