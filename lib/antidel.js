// Antidelete: jo message delete hota hai wo (content ke saath) sirf OWNER ki self chat mein aata hai.
// Jis chat se delete hua wahan kuch nahi bheja jata.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('./store');
const { tinyBold } = require('./font');
const deleteGuard = require('./deleteGuard');

const TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = parseInt(process.env.ANTIDELETE_CACHE || '1500', 10);
const TZ = process.env.TIMEZONE || 'Asia/Karachi';

// Har bot (number) ka apna data: key = "<botNumber>:<messageId>". Ek hi group mein 2 bots hon to
// dono ek dosre ke liye anjaan hain — har ek ko apne account ki deleted copy apni self chat mein milti hai.
const cache = new Map(); // "bot:id" -> { t, key, message, pushName, ts }
const handled = new Map(); // "bot:id" -> time (duplicate events se bachne ke liye)
const ck = (bot, id) => `${bot}:${id}`;

const userPart = (jid) => String(jid || '').split('@')[0].split(':')[0];

function cacheMessage(msg, botNumber) {
  try {
    if (!msg?.key?.id || !msg.message || msg.key.fromMe || !botNumber) return;
    cache.set(ck(botNumber, msg.key.id), { t: Date.now(), key: msg.key, message: msg.message, pushName: msg.pushName, ts: msg.messageTimestamp });
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  } catch (e) {}
}

const toMs = (ts) => {
  const n = typeof ts === 'object' && ts ? (ts.toNumber ? ts.toNumber() : Number(ts)) : Number(ts);
  return n ? n * 1000 : Date.now();
};
const fmt = (ms) =>
  new Date(ms).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

// Ephemeral/caption wrappers kholta hai (view-once nahi)
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

function describe(m) {
  if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return { kind: 'viewonce', label: 'View-once media' };
  if (m.conversation) return { kind: 'text', label: 'Text', text: m.conversation };
  if (m.extendedTextMessage) return { kind: 'text', label: 'Text', text: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { kind: 'image', label: 'Image', node: m.imageMessage, caption: m.imageMessage.caption };
  if (m.videoMessage) return { kind: 'video', label: m.videoMessage.gifPlayback ? 'GIF' : 'Video', node: m.videoMessage, caption: m.videoMessage.caption };
  if (m.ptvMessage) return { kind: 'video', label: 'Video note', node: m.ptvMessage };
  if (m.audioMessage) return { kind: 'audio', label: m.audioMessage.ptt ? 'Voice note' : 'Audio', node: m.audioMessage };
  if (m.stickerMessage) return { kind: 'sticker', label: 'Sticker', node: m.stickerMessage };
  if (m.documentMessage) return { kind: 'document', label: 'Document', node: m.documentMessage, caption: m.documentMessage.caption };
  if (m.contactMessage) return { kind: 'text', label: 'Contact', text: `${m.contactMessage.displayName || ''}` };
  if (m.locationMessage) return { kind: 'text', label: 'Location', text: `${m.locationMessage.degreesLatitude}, ${m.locationMessage.degreesLongitude}` };
  if (m.pollCreationMessage || m.pollCreationMessageV3) return { kind: 'text', label: 'Poll', text: (m.pollCreationMessage || m.pollCreationMessageV3).name || '' };
  return { kind: 'other', label: 'Message' };
}

async function handleAntidelete(sock, update) {
  try {
    await inner(sock, update);
  } catch (err) {
    console.error('[ANTIDELETE] error:', err.message);
  }
}

async function inner(sock, update) {
  const key = update?.key;
  if (!key?.id) return;

  const botNumber = userPart(sock.user?.id);
  if (!botNumber) return;
  const settings = await store.getInstanceSettings(botNumber);
  if (!settings.antideleteOn) return;

  // Bot ne khud moderation (antilink / anti-features / .dellink) ke liye delete kiya — owner ki chat mein dobara nahi bhejna
  const cKey = ck(botNumber, key.id);
  if (deleteGuard.has(key.id)) { cache.delete(cKey); return; }

  const entry = cache.get(cKey);
  if (!entry || Date.now() - entry.t > TTL_MS) return;
  if (handled.has(cKey)) return;
  handled.set(cKey, Date.now());
  cache.delete(cKey);
  if (handled.size > 2000) handled.delete(handled.keys().next().value);

  const selfJid = `${botNumber}@s.whatsapp.net`;
  const chatJid = key.remoteJid || entry.key.remoteJid;
  const isGroup = String(chatJid).endsWith('@g.us');

  const senderJid = isGroup ? entry.key.participant : (entry.key.remoteJidAlt || entry.key.remoteJid);
  const deleterJid = update.update?.key?.participant || senderJid;

  let chatName = 'Private chat';
  if (isGroup) {
    try { chatName = (await sock.groupMetadata(chatJid)).subject || 'Group'; } catch (e) { chatName = 'Group'; }
  }

  const m = unwrap(entry.message);
  const d = describe(m);
  const mentions = [senderJid, deleterJid].filter(Boolean);
  const sameUser = userPart(senderJid) === userPart(deleterJid);

  const row = (label, value) => `${tinyBold(label)} ${value}`;
  const header = [
    tinyBold('🗑️ Deleted message saved'),
    '',
    row('👤 Sender:', `@${userPart(senderJid)}${entry.pushName ? ` (${entry.pushName})` : ''}`),
    row('🧹 Deleted by:', sameUser ? 'Same user' : `@${userPart(deleterJid)}`),
    row(isGroup ? '👥 Group:' : '💬 Chat:', chatName),
    row('🕒 Sent:', fmt(toMs(entry.ts))),
    row('🕒 Deleted:', fmt(Date.now())),
    row('📎 Type:', tinyBold(d.label)),
  ].join('\n');

  if (d.kind === 'text') {
    await sock.sendMessage(selfJid, { text: `${header}\n\n${tinyBold('📝 Message:')}\n${d.text}`, mentions });
    return;
  }

  if (['image', 'video', 'audio', 'sticker', 'document'].includes(d.kind)) {
    let buffer = null;
    try {
      buffer = await downloadMediaMessage({ key: entry.key, message: m }, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
    } catch (e) {
      console.error('[ANTIDELETE] media download failed:', e.message);
    }
    if (!buffer) {
      await sock.sendMessage(selfJid, { text: `${header}\n\n${tinyBold('⚠️ Media could not be recovered.')}`, mentions });
      return;
    }
    const caption = `${header}${d.caption ? `\n\n${tinyBold('📝 Caption:')}\n${d.caption}` : ''}`;
    if (d.kind === 'image') await sock.sendMessage(selfJid, { image: buffer, caption, mentions });
    else if (d.kind === 'video') await sock.sendMessage(selfJid, { video: buffer, caption, mentions, gifPlayback: !!d.node.gifPlayback });
    else if (d.kind === 'document') await sock.sendMessage(selfJid, { document: buffer, mimetype: d.node.mimetype || 'application/octet-stream', fileName: d.node.fileName || 'file', caption, mentions });
    else {
      // audio / sticker mein caption nahi hota: pehle info, phir media
      await sock.sendMessage(selfJid, { text: header, mentions });
      if (d.kind === 'audio') await sock.sendMessage(selfJid, { audio: buffer, mimetype: d.node.mimetype || 'audio/ogg; codecs=opus', ptt: !!d.node.ptt });
      else await sock.sendMessage(selfJid, { sticker: buffer });
    }
    return;
  }

  const note = d.kind === 'viewonce' ? '🔒 View-once media is not saved.' : '⚠️ This message type cannot be shown.';
  await sock.sendMessage(selfJid, { text: `${header}\n\n${tinyBold(note)}`, mentions });
}

module.exports = { cacheMessage, handleAntidelete };
