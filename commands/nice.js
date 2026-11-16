// .nice — reply kiye hue view-once (image / video / voice / document) ko NORMAL media bana kar
// BOT OWNER KI APNI SELF CHAT mein bhejta hai. Sirf owner / sudo chala sakta hai; dusron ke liye chup.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const viewOnceCache = require('../lib/viewOnceCache');
const { tinyBold } = require('../lib/font');

function quotedOf(msg) {
  const m = msg?.message || {};
  for (const k of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'conversation']) {
    const c = m[k]?.contextInfo;
    if (c?.quotedMessage) return { quoted: c.quotedMessage, ctxInfo: c };
  }
  return null;
}

function unwrap(node) {
  let m = node;
  for (let i = 0; i < 6 && m; i++) {
    const inner = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message ||
      m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

function mediaOf(target) {
  if (target.imageMessage) return { type: 'image', node: target.imageMessage };
  if (target.videoMessage) return { type: 'video', node: target.videoMessage };
  if (target.audioMessage) return { type: 'audio', node: target.audioMessage };
  if (target.documentMessage) return { type: 'document', node: target.documentMessage };
  return null;
}

const userOf = (jid) => String(jid || '').split('@')[0].split(':')[0];
const say = (ctx, text) => ctx.reply(tinyBold(text));

module.exports = [
  {
    name: 'nice',
    aliases: ['vvnice', 'unlock'],
    description: 'Reply kiye hue view-once ko normal media bana kar owner ki self chat mein bhejta hai (sirf owner)',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isInstanceOwner) return; // dusron ke liye chup
      const q = quotedOf(ctx.msg);
      if (!q) return say(ctx, 'Kisi view-once image, video, voice ya document par reply karke ye likhein.');

      const hit = await viewOnceCache.get(q.ctxInfo.stanzaId); // pehle cache (RAM ya Mongo), phir quote
      console.log(`[NICE] cache ${hit ? 'HIT' : 'MISS'} for ${q.ctxInfo.stanzaId}`);
      const target = hit ? hit.message : unwrap(q.quoted);
      const media = mediaOf(target);
      if (!media) return say(ctx, 'Ye view-once media nahi hai.');

      let buffer;
      try {
        buffer = await downloadMediaMessage(
          { key: hit ? hit.key : { remoteJid: ctx.from, fromMe: false, id: q.ctxInfo.stanzaId, participant: q.ctxInfo.participant }, message: target },
          'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage }
        );
      } catch (e) {
        console.error('[NICE] download failed:', e.message);
        return say(ctx, 'Ye view-once ab download nahi ho saka (WhatsApp ne media wapas le liya ya expire ho gaya). Doosri baar try karein.');
      }

      // Owner ki apni chat (Message yourself) — yahin sab jata hai
      const selfJid = `${userOf(ctx.sock.user?.id)}@s.whatsapp.net`;
      const caption = media.node.caption || '';
      let payload;
      if (media.type === 'image') payload = { image: buffer, caption };
      else if (media.type === 'video') payload = { video: buffer, caption };
      else if (media.type === 'audio') payload = { audio: buffer, mimetype: media.node.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.node.ptt };
      else payload = { document: buffer, mimetype: media.node.mimetype || 'application/octet-stream', fileName: media.node.fileName || 'file', caption };

      return ctx.sock.sendMessage(selfJid, payload);
    },
  },
];

// Cache se seedha save (owner ka emoji reaction / emoji reply par). Quote ki zarurat nahi.
async function saveById(sock, id) {
  const hit = await viewOnceCache.get(id);
  if (!hit) return false;
  const target = hit.message;
  const media = mediaOf(target);
  if (!media) return false;
  const buffer = await downloadMediaMessage(
    { key: hit.key, message: target }, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage }
  );
  const selfJid = `${userOf(sock.user?.id)}@s.whatsapp.net`;
  const caption = media.node.caption || '';
  let payload;
  if (media.type === 'image') payload = { image: buffer, caption };
  else if (media.type === 'video') payload = { video: buffer, caption };
  else if (media.type === 'audio') payload = { audio: buffer, mimetype: media.node.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.node.ptt };
  else payload = { document: buffer, mimetype: media.node.mimetype || 'application/octet-stream', fileName: media.node.fileName || 'file', caption };
  await sock.sendMessage(selfJid, payload);
  return true;
}
module.exports.saveById = saveById;
