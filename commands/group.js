const store = require('../lib/store');

const commands = [
  {
    name: 'antilink',
    aliases: ['linkprotect'],
    description: 'Configure group antilink protection (on/off/delete/warn/kick)',
    category: 'moderation',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');

      const opt = ctx.args[0]?.toLowerCase();
      if (!opt || !['on', 'off', 'delete', 'kick', 'warn', 'all'].includes(opt)) {
        return ctx.reply(
          `⚙️ *Antilink Configuration*\n\n` +
          `• *${ctx.prefix}antilink on* (auto-delete link)\n` +
          `• *${ctx.prefix}antilink warn* (warn up to 3 times then kick)\n` +
          `• *${ctx.prefix}antilink kick* (instant kick upon link)\n` +
          `• *${ctx.prefix}antilink all* (detect all URLs, not just WhatsApp)\n` +
          `• *${ctx.prefix}antilink off* (disable)`
        );
      }

      let mode = false;
      if (opt === 'on' || opt === 'delete') mode = 'delete';
      else if (opt === 'kick') mode = 'kick';
      else if (opt === 'warn') mode = 'warn';
      else if (opt === 'all') mode = 'all';

      await store.setGroupSettings(ctx.from, { antilink: mode });
      await ctx.reply(`✅ Antilink mode updated to: *${opt.toUpperCase()}*`);
    }
  },
];

module.exports = commands;
