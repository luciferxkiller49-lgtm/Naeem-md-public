// Owner ke commands: .chstatus (channel par post; "all" = sab admin/owner channels),
// .channelreact (channel par auto reaction; follow zaroori), .forwardbot (sab linked numbers ki self chat).
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('../lib/store');
const { resolveChannel, roleOf, rememberChannel, knownChannels, CHANNEL_REACT_EMOJI } = require('../lib/channelTools');
const broadcast = require('../lib/broadcast');

const ownerOnly = (ctx) => ctx.isInstanceOwner || ctx.isOwner;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function postPayload(q, buf, text) {
  if (!q) return { text };
  if (q.type === 'image') return { image: buf, caption: text || undefined };
  if (q.type === 'video') return { video: buf, caption: text || undefined };
  if (q.type === 'audio') return { audio: buf, mimetype: q.node.mimetype || 'audio/mpeg' };
  return { document: buf, mimetype: q.node.mimetype || 'application/octet-stream', fileName: q.node.fileName || 'file', caption: text || undefined };
}

module.exports = [
  {
    name: 'chstatus',
    aliases: [],
    description: 'Channel par post: .chstatus <channel link> <text> | .chstatus all <text> (sab admin/owner channels) | media par reply',
    category: 'owner',
    async execute(ctx) {
      if (!ownerOnly(ctx)) return;
      const args = ctx.args || [];
      const first = args[0];
      if (!first) throw new Error(`Usage: ${ctx.prefix}chstatus <channel link|all> <text> (ya media par reply karke)`);
      const isAll = first.toLowerCase() === 'all';
      const text = args.slice(1).join(' ').trim();
      const q = quotedMediaOf(ctx.msg);
      if (!q && !text) throw new Error('Post ka text likhein ya media par reply karein');

      let targets;
      if (isAll) {
        targets = await knownChannels(ctx.botNumber);
        if (!targets.length) throw new Error(`Koi channel save nahi. Pehle ${ctx.prefix}chstatus <link> ya ${ctx.prefix}channelreact <link> se channel add karein`);
      } else {
        const ch = await resolveChannel(ctx.sock, first);
        await rememberChannel(ctx.botNumber, ch);
        targets = [ch];
      }

      const buf = q ? await mediaBuffer(ctx, q) : null;
      let ok = 0; let notAdmin = 0; let failed = 0;
      for (const ch of targets) {
        const role = await roleOf(ctx.sock, ch.jid);
        if (!['ADMIN', 'OWNER'].includes(role)) {
          notAdmin++;
          if (!isAll) throw new Error(`Aap is channel ke admin/owner nahi hain (role: ${role}). Post nahi hogi.`);
          continue;
        }
        try {
          const res = await ctx.sock.sendMessage(ch.jid, postPayload(q, buf, text));
          if (!res) throw new Error('WhatsApp ne post accept nahi ki');
          console.log(`[CHSTATUS] sent ${res.key?.id || '?'} to ${ch.jid} (${ch.name})`);
          ok++;
        } catch (e) {
          failed++;
          console.error(`[CHSTATUS] ${ch.name} (${ch.jid}): ${e.message}`);
          if (!isAll) throw new Error(`Post nahi hui: ${e.message}`);
        }
        if (isAll) await sleep(1500);
      }
      if (isAll) return ctx.reply(`✅ ${ok} channel mein post hui. ${notAdmin} mein aap admin/owner nahi. ${failed} mein fail.`);
      return;
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
      if (!a) throw new Error(`Usage: ${ctx.prefix}channelreact <channel link> (band karne ke liye: ${ctx.prefix}channelreact off)`);
      if (a.toLowerCase() === 'off') {
        await store.setInstanceSettings(ctx.botNumber, { channelReact: [] });
        return ctx.reply('✅ Channel reaction band kar diya.');
      }
      const ch = await resolveChannel(ctx.sock, a);
      // Admin/owner channel par follow ki zaroorat nahi: uski posts bot ko apne aap milti hain
      const role = await roleOf(ctx.sock, ch.jid);
      if (!['ADMIN', 'OWNER'].includes(role)) {
        try {
          await ctx.sock.newsletterFollow(ch.jid);
        } catch (e) {
          if (!/already|exist/i.test(String(e.message))) {
            throw new Error(`Channel follow nahi ho saka (${e.message}). Ye channel aapka nahi hai, is liye follow zaroori hai.`);
          }
        }
      }
      const s = await store.getInstanceSettings(ctx.botNumber);
      const list = Array.isArray(s.channelReact) ? s.channelReact : [];
      if (!list.includes(ch.jid)) await store.setInstanceSettings(ctx.botNumber, { channelReact: [...list, ch.jid] });
      await rememberChannel(ctx.botNumber, ch);
      // Foran live updates subscribe (warna nayi post bot tak nahi pohanchti aur react nahi hota)
      try { if (typeof ctx.sock.subscribeNewsletterUpdates === 'function') await ctx.sock.subscribeNewsletterUpdates(ch.jid); } catch (e) { console.error('[CHREACT] subscribe failed:', e.message); }
      return ctx.reply(`✅ ${ch.name} ki har nayi post par ${CHANNEL_REACT_EMOJI} react hoga.`);
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
      await broadcast.deliverPending(ctx.sock, ctx.botNumber).catch(() => {});
      return;
    },
  },
];
