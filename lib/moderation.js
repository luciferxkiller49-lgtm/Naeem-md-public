const store = require('../lib/store');
const bulkCache = require('../lib/bulkCache');

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
  {
    name: 'antidelete',
    aliases: ['antidel'],
    description: 'Toggle antidelete: group-wide in a group, or for your own DMs in private chat',
    category: 'moderation',
    async execute(ctx) {
      const opt = ctx.args[0]?.toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return ctx.reply(`Usage: *${ctx.prefix}antidelete on* or *${ctx.prefix}antidelete off*`);
      }
      const enabled = opt === 'on';

      // FIX: previously this only ever wrote to group settings, so there was
      // no way to turn antidelete off for the owner's own private chats
      // (lib/antidel.js now checks instance settings there — see that file).
      if (ctx.isGroup) {
        if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
        await store.setGroupSettings(ctx.from, { antidelete: enabled });
        await ctx.reply(`🛡️ Antidelete for this group is now: *${enabled ? 'ENABLED' : 'DISABLED'}*`);
      } else {
        if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');
        await store.setInstanceSettings(ctx.botNumber, { antidelete: enabled });
        await ctx.reply(`🛡️ Antidelete for your private chats is now: *${enabled ? 'ENABLED' : 'DISABLED'}*`);
      }
    }
  },
  {
    name: 'antiedit',
    aliases: ['antiedited'],
    description: 'Toggle edit notifications: group-wide in a group, or for your own DMs in private chat',
    category: 'moderation',
    async execute(ctx) {
      const opt = ctx.args[0]?.toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return ctx.reply(`Usage: *${ctx.prefix}antiedit on* or *${ctx.prefix}antiedit off*`);
      }
      const enabled = opt === 'on';

      // FIX: same DM-scope fix as antidelete above.
      if (ctx.isGroup) {
        if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
        await store.setGroupSettings(ctx.from, { antiedit: enabled });
        await ctx.reply(`✏️ Antiedit for this group is now: *${enabled ? 'ENABLED' : 'DISABLED'}*`);
      } else {
        if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');
        await store.setInstanceSettings(ctx.botNumber, { antiedit: enabled });
        await ctx.reply(`✏️ Antiedit for your private chats is now: *${enabled ? 'ENABLED' : 'DISABLED'}*`);
      }
    }
  },
  {
    name: 'delalllink',
    aliases: ['delallinks', 'delalllinks', 'delallurls'],
    description: 'Is group mein ab tak dekhe gaye tamam link wale messages ek sath delete karta hai',
    category: 'moderation',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Pehle bot ko group admin banayein, tabhi messages delete ho sakte hain.');

      const keys = bulkCache.takeLinkKeys(ctx.from);
      if (!keys.length) {
        return ctx.reply('ℹ️ Abhi tak koi link wala message record nahi hua jo delete ho sake (bot online hone ke baad aaye hue messages hi yaad rehte hain).');
      }

      await ctx.reply(`🧹 ${keys.length} link message(s) delete kiye ja rahe hain...`);
      let done = 0;
      for (const key of keys) {
        try { await ctx.sock.sendMessage(ctx.from, { delete: key }); done++; } catch (e) {}
        await new Promise((r) => setTimeout(r, 200)); // WhatsApp ko ek sath spam na lage
      }
      await ctx.reply(`✅ ${done}/${keys.length} link message(s) delete ho gaye.`);
    }
  },
  {
    name: 'delallstatus',
    aliases: ['delallstatuses', 'delallstories', 'delallgcstatus'],
    description: 'Is group mein ab tak dekhe gaye tamam group-status (story) posts ek sath delete karta hai',
    category: 'moderation',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Pehle bot ko group admin banayein, tabhi messages delete ho sakte hain.');

      const keys = bulkCache.takeStatusKeys(ctx.from);
      if (!keys.length) {
        return ctx.reply('ℹ️ Abhi tak koi group-status post record nahi hua jo delete ho sake (bot online hone ke baad aaye hue posts hi yaad rehte hain).');
      }

      await ctx.reply(`🧹 ${keys.length} status post(s) delete kiye ja rahe hain...`);
      let done = 0;
      for (const key of keys) {
        try { await ctx.sock.sendMessage(ctx.from, { delete: key }); done++; } catch (e) {}
        await new Promise((r) => setTimeout(r, 200));
      }
      await ctx.reply(`✅ ${done}/${keys.length} status post(s) delete ho gaye.`);
    }
  }
];

module.exports = commands;
