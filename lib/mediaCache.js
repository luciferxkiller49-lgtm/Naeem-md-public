// Bara media (menu video / voice) har baar upload nahi hota: ek baar upload karke
// uski WhatsApp reference kuch ghante yaad rakhi jati hai (sab numbers ke liye).
// Isse menu bohat tez jata hai.
const { generateWAMessageContent, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

const TTL_MS = 3 * 60 * 60 * 1000;
const cache = new Map(); // key -> { t, content }

const FIELD = { video: 'videoMessage', audio: 'audioMessage', image: 'imageMessage' };

async function getContent(sock, key, payload) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.content;
  const content = await generateWAMessageContent(payload, { upload: sock.waUploadToServer, logger: console });
  cache.set(key, { t: Date.now(), content });
  return content;
}

/**
 * kind: 'video' | 'audio' | 'image'
 * payload: sendMessage jaisa content (video: {url}, mimetype, ...)
 * extra: { caption, contextInfo, quoted }
 */
async function sendCachedMedia(sock, jid, kind, key, payload, extra = {}) {
  const field = FIELD[kind];
  try {
    if (process.env.MENU_CACHE === '0') throw new Error('cache disabled');
    const content = await getContent(sock, key, payload);
    const node = { ...content[field] };
    if (extra.caption !== undefined) node.caption = extra.caption;
    if (extra.contextInfo) node.contextInfo = extra.contextInfo;
    const full = generateWAMessageFromContent(jid, { [field]: node }, { userJid: sock.user.id, quoted: extra.quoted });
    await sock.relayMessage(jid, full.message, { messageId: full.key.id });
    return full;
  } catch (err) {
    cache.delete(key);
    // Cache wala raasta fail ho to normal tareeqe se bhejte hain
    const normal = { ...payload };
    if (extra.caption !== undefined) normal.caption = extra.caption;
    if (extra.contextInfo) normal.contextInfo = extra.contextInfo;
    return sock.sendMessage(jid, normal, extra.quoted ? { quoted: extra.quoted } : undefined);
  }
}

module.exports = { sendCachedMedia };
