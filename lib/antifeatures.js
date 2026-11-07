// Group anti-features: antivoice, antisticker, antivideo, antigcstatus, antimention
// Har ek ke 4 modes: off | delete | warn | kick
const store = require('./store');
const { tinyBold } = require('./font');

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

async function act(sock, msg, from, sender, mode, label, field) {
  const tag = `@${String(sender).split('@')[0].split(':')[0]}`;
  const say = (text) => sock.sendMessage(from, { text: tinyBold(text), mentions: [sender] });

  try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) { console.error(`[${field}] delete failed:`, e.message); }

  if (mode === 'kick') {
    try {
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
      await say(`⚠️ ${tag} was removed for sending ${label}.`);
    } catch (e) {
      await say(`⚠️ ${tag}, ${label} are not allowed in this group.`);
    }
  } else if (mode === 'warn') {
    const k = `${from}:${sender}:${field}`;
    const count = (warnings.get(k) || 0) + 1;
    if (count >= MAX_WARNINGS) {
      warnings.delete(k);
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await say(`🚫 ${tag} was warned ${MAX_WARNINGS} times and has been removed.`);
      } catch (e) {
        await say(`🚫 ${tag} reached ${MAX_WARNINGS} warnings.`);
      }
    } else {
      warnings.set(k, count);
      await say(`⚠️ Warning [${count}/${MAX_WARNINGS}] ${tag}, ${label} are not allowed in this group.`);
    }
  } else {
    await say(`⚠️ ${tag}, ${label} are not allowed in this group.`);
  }
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
