const store = require('../lib/store');
const newsletters = require('../lib/newsletters');

const commands = [
  {
    name: 'chatbot',
    aliases: ['aichatbot', 'smartbot'],
    description: 'Toggle automatic AI conversation responder',
    category: 'ai',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const opt = ctx.args[0]?.toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return ctx.reply(`Usage: *${ctx.prefix}chatbot on* or *${ctx.prefix}chatbot off*`);
      }

      const enabled = opt === 'on';
      await store.setInstanceSettings(ctx.botNumber, { chatbot: enabled });
      await ctx.reply(`🤖 AI Chatbot Auto-Reply is now: *${enabled ? 'ACTIVE' : 'DISABLED'}*`);
    }
  },
  {
    name: 'newsletter',
    aliases: ['channel'],
    description: 'Follow, unfollow or mute a WhatsApp Newsletter channel',
    category: 'utility',
    async execute(ctx) {
      if (!ctx.isInstanceOwner) return ctx.reply('❌ This command is only for the bot owner.');
      const action = ctx.args[0]?.toLowerCase();
      const channelJid = ctx.args[1];

      if (!['follow', 'unfollow', 'mute', 'unmute'].includes(action) || !channelJid) {
        return ctx.reply(
          `📢 *Newsletter / Channel Controls:*\n\n` +
          `• *${ctx.prefix}newsletter follow <jid>*\n` +
          `• *${ctx.prefix}newsletter unfollow <jid>*\n` +
          `• *${ctx.prefix}newsletter mute <jid>*\n` +
          `• *${ctx.prefix}newsletter unmute <jid>*`
        );
      }

      try {
        if (action === 'follow') {
          await newsletters.follow(ctx.sock, channelJid);
          await ctx.reply(`✅ Followed newsletter ${channelJid}`);
        } else if (action === 'unfollow') {
          await newsletters.unfollow(ctx.sock, channelJid);
          await ctx.reply(`👋 Unfollowed newsletter ${channelJid}`);
        } else if (action === 'mute') {
          await newsletters.mute(ctx.sock, channelJid, true);
          await ctx.reply(`🔇 Muted newsletter ${channelJid}`);
        } else if (action === 'unmute') {
          await newsletters.mute(ctx.sock, channelJid, false);
          await ctx.reply(`🔊 Unmuted newsletter ${channelJid}`);
        }
      } catch (err) {
        ctx.reply('❌ Channel operation failed: ' + err.message);
      }
    }
  },
  {
    name: 'effects',
    aliases: ['audioeffects', 'soundfx'],
    description: 'List all available audio editor effects from Queen-MD',
    category: 'media',
    async execute(ctx) {
      const effectsList = [
        'bass', 'slow', 'nightcore', 'deep', 'fast', 'robot', 'reverse', 'smooth', 'blown', 'squirrel'
      ];
      let text = `🎧 *AVAILABLE AUDIO EFFECTS*\n\nReply to any audio or voice note with:\n`;
      effectsList.forEach(e => {
        text += `• *${ctx.prefix}${e}*\n`;
      });
      await ctx.reply(text);
    }
  }
];

module.exports = commands;
