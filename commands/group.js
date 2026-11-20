const store = require('../lib/store');
const { groupTargets } = require('../lib/scope');

const commands = [
  {
    name: 'antilink',
    aliases: ['linkprotect'],
    description: 'Configure group antilink protection (on/off/delete/warn/kick)',
    category: 'moderation',
    async execute(ctx) {
      const selfScope = !ctx.isGroup && (ctx.isInstanceOwner || ctx.isOwner);
      if (!ctx.isGroup && !selfScope) return ctx.reply('❌ Group only command.');
      if (ctx.isGroup && !ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');

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
      if (opt === 'on' || opt === 'kick') mode = 'kick'; // on = pehli baar mein remove (delete + kick)
      else if (opt === 'delete') mode = 'delete';
      else if (opt === 'kick') mode = 'kick';
      else if (opt === 'warn') mode = 'warn';
      else if (opt === 'all') mode = 'all';

      if (selfScope) {
        const { jids } = await groupTargets(ctx, { adminOnly: true });
        for (const jid of jids) await store.setGroupSettings(jid, { antilink: mode });
        return ctx.reply(`✅ Antilink *${opt.toUpperCase()}* ${jids.length} groups mein set hua (jahan bot admin hai).`);
      }
      await store.setGroupSettings(ctx.from, { antilink: mode });
      await ctx.reply(`✅ Antilink mode updated to: *${opt.toUpperCase()}*` + (mode === 'kick' ? '\n⚠️ User will be kicked on first attempt (link bhejte hi remove).' : ''));
    }
  },
];

module.exports = commands;
