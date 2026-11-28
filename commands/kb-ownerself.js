const { tinyBold } = require('../lib/font');
const viewOnceCache = require('../lib/viewOnceCache');
const { getUptimeText } = require('../lib/uptime');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const OWNER_ONLY = '❌ This command is only for the bot owner.';

const VV_NOT_FOUND = tinyBold(
  'Ye view-once abhi save nahi ho pa raha.\n' +
  'Ye WhatsApp ki taraf ka masla hai (bot tak content nahi aa raha), bot ka issue nahi.\n' +
  'Jab ye theek hoga, naye view-once apne aap self chat mein save honge.'
);

function idFromNumber(n) {
  return (n || '').replace(/[^0-9]/g, '');
}

// Quote kisi bhi message type mein ho sakta hai (text, extended, image/video caption, ephemeral wrapper)
function quotedOf(msg) {
  const m = msg?.message || {};
  for (const k of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'conversation']) {
    const c = m[k]?.contextInfo || m[k]?.contextInfo;
    if (c?.quotedMessage) return { quoted: c.quotedMessage, ctxInfo: c };
  }
  return null;
}

// Wrappers ko andar tak khol kar asli media dhoondhta hai (view-once v1/v2/extension, ephemeral, document-with-caption)
function unwrapMedia(node) {
  let m = node;
  for (let i = 0; i < 6 && m; i++) {
    const inner = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message ||
      m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

async function extractViewOnce(sock, msg) {
  const q = quotedOf(msg);
  if (!q) return null;
  // Pehle cache (jo message aane par save hua, mediaKey samet), phir quote
  const hit = await viewOnceCache.get(q.ctxInfo.stanzaId);
  const target = hit ? hit.message : unwrapMedia(q.quoted);
  const imageMsg = target?.imageMessage;
  const videoMsg = target?.videoMessage;
  if (!imageMsg && !videoMsg) return null;
  try {
    // Quoted msg ki apni key/contextInfo se download: media key khali ho to bhi library khud try karti hai
    const quotedKey = hit ? hit.key : {
      remoteJid: msg.key.remoteJid,
      fromMe: false,
      id: q.ctxInfo.stanzaId,
      participant: q.ctxInfo.participant,
    };
    const buffer = await downloadMediaMessage(
      { key: quotedKey, message: target },
      'buffer',
      {},
      { logger: console, reuploadRequest: sock.updateMediaMessage }
    );
    return { buffer, caption: imageMsg?.caption || videoMsg?.caption || '', isImage: !!imageMsg };
  } catch (err) {
    console.error('extractViewOnce download error:', err.message);
    return null;
  }
}

module.exports = [
  {
    name: 'vv',
    description: 'View-once media ko dobara isi chat mein bhejta hai (reply karke, sirf bot owner)',
    execute: async ({ sock, msg, from, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: OWNER_ONLY });
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: VV_NOT_FOUND });
      await sock.sendMessage(from, media.isImage ? { image: media.buffer, caption: media.caption } : { video: media.buffer, caption: media.caption });
    },
  },
  {
    name: 'vv2',
    description: 'View-once media ko owner ki apni DM mein bhejta hai (sirf bot owner)',
    execute: async ({ sock, msg, from, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: OWNER_ONLY });
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: VV_NOT_FOUND });
      const ownerJid = `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
      await sock.sendMessage(ownerJid, media.isImage ? { image: media.buffer, caption: media.caption } : { video: media.buffer, caption: media.caption });
      await sock.sendMessage(from, { text: '✅ Sent to your DM.' });
    },
  },
  {
    name: 'vv3',
    description: 'View-once media ko document ki tarah bhejta hai (dobara view-once na bane, sirf bot owner)',
    execute: async ({ sock, msg, from, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: OWNER_ONLY });
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: VV_NOT_FOUND });
      await sock.sendMessage(from, { document: media.buffer, mimetype: media.isImage ? 'image/jpeg' : 'video/mp4', fileName: media.isImage ? 'image.jpg' : 'video.mp4' });
    },
  },
  {
    name: 'block',
    description: 'User ko WhatsApp par block karta hai',
    execute: async ({ sock, msg, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = mentioned || (args[0] ? `${idFromNumber(args[0])}@s.whatsapp.net` : null);
      if (!target) return sock.sendMessage(from, { text: 'Number ya @mention do.' });
      await sock.updateBlockStatus(target, 'block');
      await sock.sendMessage(from, { text: `Block is on for @${target.split('@')[0]}.`, mentions: [target] });
    },
  },
  {
    name: 'unblock',
    description: 'User ko unblock karta hai',
    execute: async ({ sock, msg, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = mentioned || (args[0] ? `${idFromNumber(args[0])}@s.whatsapp.net` : null);
      if (!target) return sock.sendMessage(from, { text: 'Number ya @mention do.' });
      await sock.updateBlockStatus(target, 'unblock');
      await sock.sendMessage(from, { text: `Block is off for @${target.split('@')[0]}.`, mentions: [target] });
    },
  },
  {
    name: 'msg',
    description: 'Kisi number ko seedha message bhejta hai: .msg 923xxxxxxxxx text',
    execute: async ({ sock, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      const number = idFromNumber(args[0]);
      const text = args.slice(1).join(' ');
      if (!number || !text) return sock.sendMessage(from, { text: 'Format: .msg 923xxxxxxxxx aapka message' });
      await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
      await sock.sendMessage(from, { text: '✅ Message sent.' });
    },
  },
  {
    name: 'fullpp',
    description: 'Kisi ki full-size profile picture bhejta hai (reply/mention se)',
    execute: async ({ sock, msg, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const quoted = msg.message.extendedTextMessage?.contextInfo?.participant;
      const target = mentioned || quoted || (args[0] ? `${idFromNumber(args[0])}@s.whatsapp.net` : from);
      try {
        const url = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(from, { image: { url }, caption: `📸 @${target.split('@')[0]}`, mentions: [target] });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not get the profile picture (it may be private).' });
      }
    },
  },
  {
    name: 'forward',
    description: 'Reply kiye gaye message ko kisi number/group par forward karta hai',
    execute: async ({ sock, msg, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted) return sock.sendMessage(from, { text: 'Reply to a message with this command: .forward 923xxxxxxxxx' });
      const number = idFromNumber(args[0]);
      if (!number) return sock.sendMessage(from, { text: 'Format: .forward 923xxxxxxxxx' });
      await sock.sendMessage(`${number}@s.whatsapp.net`, { forward: { message: quoted, key: msg.key } });
      await sock.sendMessage(from, { text: '✅ Forwarded.' });
    },
  },
  {
    name: 'leave',
    description: 'Bot ko group se nikal deta hai (group admin ka kaam nahi, self-action hai)',
    execute: async ({ sock, from, isInstanceOwner }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      await sock.sendMessage(from, { text: '👋 Bye! Bot is group se nikal raha hai.' });
      await sock.groupLeave(from);
    },
  },
];