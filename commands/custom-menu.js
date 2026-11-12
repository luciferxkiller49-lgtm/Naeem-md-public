// Har bot-user apna menu ka DP/video aur owner-name khud set kar sakta hai.
// Dono sirf usi number ke apne .menu par dikhte hain — kisi aur bot ko
// affect nahi karte. MongoDB mein number ke naam par save hote hain, is
// liye disconnect/reconnect ya server badalne se khatam nahi hote.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('../lib/store');

const MAX_BYTES = 8 * 1024 * 1024; // ~8MB — MongoDB ke 16MB document limit se kaafi neeche (base64 ~33% badha deta hai)

function findMedia(msg) {
  const direct = msg.message?.imageMessage ? { type: 'image', m: msg.message.imageMessage, key: msg.key, message: msg.message }
    : msg.message?.videoMessage ? { type: 'video', m: msg.message.videoMessage, key: msg.key, message: msg.message }
    : null;
  if (direct) return direct;

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const qKey = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return null;
  if (quoted.imageMessage) return { type: 'image', m: quoted.imageMessage, key: { ...msg.key, id: qKey.stanzaId, participant: qKey.participant }, message: quoted };
  if (quoted.videoMessage) return { type: 'video', m: quoted.videoMessage, key: { ...msg.key, id: qKey.stanzaId, participant: qKey.participant }, message: quoted };
  return null;
}

module.exports = [
  {
    name: 'setbotdp',
    aliases: ['setmenudp', 'setmenuvideo'],
    description: 'Apne .menu ke liye apni khud ki photo/video set karein (sirf aap ka bot affect hoga)',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const found = findMedia(ctx.msg);
      if (!found) {
        return ctx.reply(`Usage: koi photo/video ${ctx.prefix}setbotdp caption ke sath bhejein, ya kisi photo/video par reply kar ke ${ctx.prefix}setbotdp likhein.`);
      }

      if (found.m.fileLength && Number(found.m.fileLength) > MAX_BYTES) {
        return ctx.reply(`❌ File bohot badi hai (max ~8MB). Chhoti video/photo bhejein.`);
      }

      try {
        const buffer = await downloadMediaMessage(
          { key: found.key, message: found.message },
          'buffer',
          {},
          { logger: console, reuploadRequest: ctx.sock.updateMediaMessage }
        );
        if (buffer.length > MAX_BYTES) {
          return ctx.reply(`❌ File bohot badi hai (max ~8MB). Chhoti video/photo bhejein.`);
        }
        await store.setMenuMedia(ctx.botNumber, {
          type: found.type,
          data: buffer.toString('base64'),
          mimetype: found.m.mimetype || (found.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        });
        await ctx.reply(`✅ Aap ka naya menu ${found.type === 'video' ? 'video' : 'photo'} set ho gaya — ${ctx.prefix}menu chala kar check kar lein.`);
      } catch (err) {
        console.error('[SETBOTDP] download failed:', err.message);
        await ctx.reply('❌ Media download nahi ho saka, dobara koshish karein.');
      }
    },
  },
  {
    name: 'setownername',
    description: 'Apne .menu mein dikhne wala OWNER naam set karein (sirf aap ka bot affect hoga)',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}setownername <naya naam>`);

      await store.setInstanceSettings(ctx.botNumber, { ownerName: ctx.text });
      await ctx.reply(`✅ Menu mein owner naam ab: *${ctx.text}*`);
    },
  },
];
