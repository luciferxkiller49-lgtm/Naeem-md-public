const store = require('../lib/store');

const commands = [
  {
    name: 'setprefix',
    aliases: ['prefix'],
    description: 'Change bot prefix for this WhatsApp number',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Only the bot owner can change the command prefix.');

      const newPrefix = ctx.args[0];
      if (!newPrefix || newPrefix.length > 2) {
        return ctx.reply('❌ Please specify a valid prefix (1 or 2 characters). Example: *!setprefix .*');
      }

      await store.setInstanceSettings(ctx.botNumber, { prefix: newPrefix });
      await ctx.reply(`✅ Command prefix has been updated to: *${newPrefix}*`);
    }
  },
  {
    name: 'mode',
    aliases: ['workmode'],
    description: 'Switch between public and private (self-only) mode',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const targetMode = ctx.args[0]?.toLowerCase();
      if (targetMode !== 'public' && targetMode !== 'private') {
        return ctx.reply(`Usage: *${ctx.prefix}mode public* or *${ctx.prefix}mode private*`);
      }

      await store.setInstanceSettings(ctx.botNumber, { mode: targetMode });
      await ctx.reply(`🔒 Bot operating mode is now set to: *${targetMode.toUpperCase()}*`);
    }
  },
  {
    name: 'autoread',
    aliases: ['readreceipt'],
    description: 'Toggle auto-read message blue ticks',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const opt = ctx.args[0]?.toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return ctx.reply(`Usage: *${ctx.prefix}autoread on* or *${ctx.prefix}autoread off*`);
      }

      const enabled = opt === 'on';
      await store.setInstanceSettings(ctx.botNumber, { autoRead: enabled });
      await ctx.reply(`👀 Auto-read messages is now: *${enabled ? 'ON' : 'OFF'}*`);
    }
  },
  {
    name: 'autotyping',
    aliases: ['presence'],
    description: 'Toggle auto-typing presence simulation',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const opt = ctx.args[0]?.toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return ctx.reply(`Usage: *${ctx.prefix}autotyping on* or *${ctx.prefix}autotyping off*`);
      }

      const enabled = opt === 'on';
      await store.setInstanceSettings(ctx.botNumber, { autoTyping: enabled });
      await ctx.reply(`✍️ Auto-typing indicator is now: *${enabled ? 'ON' : 'OFF'}*`);
    }
  },
  {
    name: 'setintro',
    // FIX: 'intro' pehle isi command ka alias tha, aur kb-settings.js mein
    // bhi ek ALAG 'intro' command tha jo saved intro DIKHATA hai. Dono
    // "intro" naam par takra rahe the — jo pehle load hota wahi jeetta, is
    // liye kabhi .intro se set ho jata, kabhi display. Ab 'setintro' sirf
    // SET karta hai, 'intro' (kb-settings.js mein) sirf DIKHATA hai — dono
    // poori tarah alag, bina kisi takraav ke.
    description: 'Set a custom introduction message for this bot',
    category: 'settings',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');
      if (!ctx.text) return ctx.reply(`Usage: *${ctx.prefix}setintro <Your custom message>*`);

      await store.setIntro(ctx.botNumber, ctx.text);
      await ctx.reply('✅ Custom introduction text saved successfully.');
    }
  }
];

module.exports = commands;
