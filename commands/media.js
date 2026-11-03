const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { createSticker } = require('../lib/sticker-maker');
const { processAudio, EFFECTS } = require('../lib/audioeditor');
const config = require('../config');

const commands = [
  {
    name: 'sticker',
    aliases: ['s', 'stk'],
    description: 'Convert image or video to a WhatsApp sticker',
    category: 'media',
    async execute(ctx) {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const targetMsg = quoted ? { message: quoted } : ctx.msg;

      const isImage = !!(targetMsg.message?.imageMessage);
      const isVideo = !!(targetMsg.message?.videoMessage);

      if (!isImage && !isVideo) {
        return ctx.reply(`❌ Please reply to an image or short video with *${ctx.prefix}sticker*`);
      }

      await ctx.react('🎨');
      try {
        const buffer = await downloadMediaMessage(
          targetMsg,
          'buffer',
          {},
          { reuploadRequest: ctx.sock.updateMediaMessage }
        );

        const pack = ctx.args[0] || config.PACK_NAME;
        const author = ctx.args.slice(1).join(' ') || config.PACK_AUTHOR;

        const stickerData = await createSticker(buffer, isVideo, pack, author);

        await ctx.sock.sendMessage(ctx.from, {
          sticker: stickerData
        }, { quoted: ctx.msg });

        await ctx.react('✨');
      } catch (err) {
        ctx.reply('❌ Failed to create sticker: ' + err.message);
      }
    }
  },
  {
    name: 'take',
    aliases: ['wm', 'steal'],
    description: 'Change sticker packname and author name',
    category: 'media',
    async execute(ctx) {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted?.stickerMessage) {
        return ctx.reply(`❌ Please reply to a sticker with *${ctx.prefix}take <Pack> | <Author>*`);
      }

      const input = ctx.text || 'Extreme | Lucifer';
      const [pack, author] = input.split('|').map(s => s.trim());

      await ctx.react('✂️');
      try {
        const buffer = await downloadMediaMessage(
          { message: quoted },
          'buffer',
          {},
          { reuploadRequest: ctx.sock.updateMediaMessage }
        );

        const stickerData = await createSticker(buffer, false, pack, author || config.PACK_AUTHOR);
        await ctx.sock.sendMessage(ctx.from, { sticker: stickerData }, { quoted: ctx.msg });
      } catch (err) {
        ctx.reply('❌ Failed to re-watermark sticker: ' + err.message);
      }
    }
  },
  {
    name: 'audioeffect',
    aliases: ['bass', 'slow', 'nightcore', 'deep', 'fast', 'robot'],
    description: 'Apply audio effects to voice note or audio',
    category: 'media',
    async execute(ctx) {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const isAudio = quoted?.audioMessage || ctx.msg.message?.audioMessage;

      if (!isAudio) {
        return ctx.reply(`❌ Please reply to an audio or voice note with *${ctx.prefix}bass*, *${ctx.prefix}slow*, *${ctx.prefix}nightcore*, etc.`);
      }

      const effect = ctx.trigger || 'bass';
      await ctx.react('🎧');

      try {
        const targetMsg = quoted ? { message: quoted } : ctx.msg;
        const buffer = await downloadMediaMessage(
          targetMsg,
          'buffer',
          {},
          { reuploadRequest: ctx.sock.updateMediaMessage }
        );

        const modified = await processAudio(buffer, effect);

        await ctx.sock.sendMessage(ctx.from, {
          audio: modified,
          mimetype: 'audio/mp4',
          ptt: false
        }, { quoted: ctx.msg });
      } catch (err) {
        ctx.reply('❌ Error applying audio effect: ' + err.message);
      }
    }
  }
];

module.exports = commands;
