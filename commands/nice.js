// .nice — reply kiye hue view-once (image/video/voice) ko us hi chat mein NORMAL media bana kar bhejta hai.
// Sirf wahi chalata hai jo bot ka owner / sudo ho. Owner ki apni chat mein jawab nahi aata ya "ho gaya" bhi nahi bhejta
// (sirf media jata hai) — taake koi bhi kisi group mein pakda na jaye.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

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

function viewOnceKind(target) {
  // Asli view-once ki pehchan: wrapper ya flag. Normal media par nice ko kuch nahi karna.
  return target.imageMessage || target.videoMessage || target.audioMessage || null;
}

module.exports = [
  {
    name: 'nice',
    aliases: ['vvnice', 'unlock'],
    description: 'Reply kiye hue view-once ko normal media bana kar isi chat mein bhejta hai (sirf owner)',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isInstanceOwner) return;           // dusron ke liye chup — koi jawab nahi
      const q = quotedOf(ctx.msg);
      if (!q) return ctx.reply('ℹ️ Kisi view-once image, video ya voice message par reply karke ye likhein.');

      const wrapper = q.quoted;
      const target = unwrap(wrapper);
      const media = viewOnceKind(target);
      if (!media) return ctx.reply('ℹ️ Ye view-once media nahi hai.');

      const type = target.imageMessage ? 'image' : target.videoMessage ? 'video' : 'audio';
      let buffer;
      try {
        buffer = await downloadMediaMessage(
          { key: { remoteJid: ctx.from, fromMe: false, id: q.ctxInfo.stanzaId, participant: q.ctxInfo.participant }, message: target },
          'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage }
        );
      } catch (e) {
        console.error('[NICE] download failed:', e.message);
        return ctx.reply('❌ Ye view-once ab download nahi ho saka (WhatsApp ne media wapas le liya ya expire ho gaya). Doosri baar try karein.');
      }

      const caption = media.caption || '';
      const opts = { quoted: ctx.msg };
      if (type === 'image') return ctx.sock.sendMessage(ctx.from, { image: buffer, caption }, opts);
      if (type === 'video') return ctx.sock.sendMessage(ctx.from, { video: buffer, caption }, opts);
      return ctx.sock.sendMessage(ctx.from, { audio: buffer, mimetype: media.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.ptt }, opts);
    },
  },
];
