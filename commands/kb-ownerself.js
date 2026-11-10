const { getUptimeText } = require('../lib/uptime');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

function idFromNumber(n) {
  return (n || '').replace(/[^0-9]/g, '');
}

async function extractViewOnce(sock, msg) {
  const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const target =
    quoted.viewOnceMessageV2Extension?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted.viewOnceMessage?.message ||
    quoted;
  const imageMsg = target?.imageMessage;
  const videoMsg = target?.videoMessage;
  if (!imageMsg && !videoMsg) return null;
  if (!(imageMsg || videoMsg).mediaKey?.length) return null; // media key khali (pehle hi khul chuka / purana) — download mumkin nahi
  try {
    const buffer = await downloadMediaMessage(
      { key: msg.key, message: target },
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
    description: 'View-once media ko dobara isi chat mein bhejta hai (reply karke)',
    execute: async ({ sock, msg, from }) => {
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: 'Reply to a view-once image/video with this command (it may have already expired or opened).' });
      await sock.sendMessage(from, media.isImage ? { image: media.buffer, caption: media.caption } : { video: media.buffer, caption: media.caption });
    },
  },
  {
    name: 'vv2',
    description: 'View-once media ko owner ki apni DM mein bhejta hai',
    execute: async ({ sock, msg, from }) => {
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: 'Reply to a view-once image/video with this command (it may have already expired or opened).' });
      const ownerJid = `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
      await sock.sendMessage(ownerJid, media.isImage ? { image: media.buffer, caption: media.caption } : { video: media.buffer, caption: media.caption });
      await sock.sendMessage(from, { text: '✅ Sent to your DM.' });
    },
  },
  {
    name: 'vv3',
    description: 'View-once media ko document ki tarah bhejta hai (dobara view-once na bane)',
    execute: async ({ sock, msg, from }) => {
      const media = await extractViewOnce(sock, msg);
      if (!media) return sock.sendMessage(from, { text: 'Reply to a view-once image/video with this command (it may have already expired or opened).' });
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
  {
    name: 'pair',
    description: 'Chat se hi naya WhatsApp number pair karta hai (web panel ke bina)',
    execute: async ({ sock, from, args, isInstanceOwner, addInstance }) => {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only this bot\'s owner can use this command.' });

      const number = idFromNumber(args[0]);
      if (!number || number.length < 10) {
        return sock.sendMessage(from, { text: 'Format: .pair 923001234567 (full number with country code, no leading 0)' });
      }
      if (number.startsWith('0')) {
        return sock.sendMessage(from, {
          text: 'Please include the country code without a leading 0 — e.g. 923001234567 for Pakistan, not 03001234567.',
        });
      }

      await sock.sendMessage(from, { text: `⏳ Generating pairing code for ${number}...` });
      try {
        const { code } = await addInstance(number);
        if (!code) throw new Error('No code returned');
        await sock.sendMessage(from, {
          text: `✅ Pairing code for ${number}: *${code}*\n\nOn that phone: WhatsApp > Linked Devices > Link with phone number, then enter this code.`,
        });
      } catch (err) {
        console.error('.pair error:', err.message);
        await sock.sendMessage(from, { text: `❌ Could not generate a pairing code: ${err.message}` });
      }
    },
  },
];