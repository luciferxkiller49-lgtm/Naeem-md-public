// Owner ke commands: .chstatus (admin/owner channel par post), .channelreact (channel posts par auto reaction),
// .forwardbot (owner ka message sab linked numbers ki self chat mein ek baar).
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('../lib/store');
const { resolveChannel, CHANNEL_REACT_EMOJI } = require('../lib/channelTools');
const broadcast = require('../lib/broadcast');

const ownerOnly = (ctx) => ctx.isInstanceOwner || ctx.isOwner;

function quotedMediaOf(msg) {
  const ci = msg?.message?.extendedTextMessage?.contextInfo;
  if (!ci?.quotedMessage) return null;
  let m = ci.quotedMessage;
  for (let i = 0; i < 6 && m; i++) {
    const inner = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message || m.ephemeralMessage?.message;
    if (!inner) break;
    m = inner;
  }
  if (m?.imageMessage) return { type: 'image', node: m.imageMessage, target: m, ci };
  if (m?.videoMessage) return { type: 'video', node: m.videoMessage, target: m, ci };
  if (m?.audioMessage) return { type: 'audio', node: m.audioMessage, target: m, ci };
  if (m?.documentMessage) return { type: 'document', node: m.documentMessage, target: m, ci };
  return null;
}

async function mediaBuffer(ctx, q) {
  const key = { remoteJid: ctx.from, fromMe: false, id: q.ci.stanzaId, participant: q.ci.participant };
  const buf = await downloadMediaMessage({ key, message: q.target }, 'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage });
  if (buf.length > broadcast.MAX_MEDIA_BYTES) throw new Error('Media 10 MB se bada hai');
  return buf;
}

module.exports = [
  {
    name: 'chstatus',
    aliases: [],
    description: 'Channel par post (sirf wahan jahan aap admin/owner hain): .chstatus <channel link> <text> ya media par reply',
    category: 'owner',
    async execute(ctx) {
      if (!ownerOnly(ctx)) return;
      const [link, ...rest] = ctx.args || [];
      if (!link) throw new Error(`Usage: ${ctx.prefix}chstatus <channel link> <text> (ya media par reply karke)`);
      const ch = await resolveChannel(ctx.sock, link);
      if (!['ADMIN', 'OWNER'].includes(ch.role)) throw new Error(`Aap is channel ke admin/owner nahi hain (role: ${ch.role})`);
      const text = rest.join(' ').trim();
      const q = quotedMediaOf(ctx.msg);
      if (q) {
        const buf = await mediaBuffer(ctx, q);
        const payload = q.type === 'image' ? { image: buf, caption: text || undefined }
          : q.type === 'video' ? { video: buf, caption: text || undefined }
          : q.type === 'audio' ? { audio: buf, mimetype: q.node.mimetype || 'audio/mpeg' }
          : { document: buf, mimetype: q.node.mimetype || 'application/octet-stream', fileName: q.node.fileName || 'file', caption: text || undefined };
        return ctx.sock.sendMessage(ch.jid, payload);
      }
      if (!text) throw new Error('Post ka text likhein ya media par reply karein');
      return ctx.sock.sendMessage(ch.jid, { text });
    },
  },
  {
    name: 'channelreact',
    aliases: [],
    description: 'Channel link do: uki har nayi post par auto reaction. .channelreact off = sab band',
    category: 'owner',
    async execute(ctx) {
      if (!ownerOnly(ctx)) return;
      const a = (ctx.args || [])[0];
      const s = await store.getInstanceSettings(ctx.botNumber);
      const list = Array.isArray(s.channelReact) ? s.channelReact : [];
      if (!a) throw new Error(`Usage: ${ctx.prefix}channelreact <channel link> (band karne ke liye: ${ctx.prefix}channelreact off)`);
      if (a.toLowerCase() === 'off') {
        await store.setInstanceSettings(ctx.botNumber, { channelReact: [] });
        return;
      }
      const ch = await resolveChannel(ctx.sock, a);
      if (!list.includes(ch.jid)) {
        await store.setInstanceSettings(ctx.botNumber, { channelReact: [...list, ch.jid] });
      }
      await ctx.sock.newsletterFollow(ch.jid).catch(() => {});
      return;
    },
  },
  {
    name: 'forwardbot',
    aliases: [],
    description: 'Owner ka message (text/media, ya media par reply) sab linked numbers ki self chat mein ek baar',
    category: 'owner',
    async execute(ctx) {
      if (!ownerOnly(ctx)) return;
      const text = (ctx.args || []).join(' ').trim();
      const q = quotedMediaOf(ctx.msg);
      if (q) {
        const buf = await mediaBuffer(ctx, q);
        await broadcast.publish({ kind: 'media', type: q.type, data: buf.toString('base64'), mimetype: q.node.mimetype, fileName: q.node.fileName, caption: text || q.node.caption || '' });
      } else {
        if (!text) throw new Error('Message likhein ya media par reply karein');
        await broadcast.publish({ kind: 'text', text });
      }
      // Is number ki apni self chat mein foran
      await broadcast.deliverPending(ctx.sock, ctx.botNumber).catch(() => {});
      return;
    },
  },
];
