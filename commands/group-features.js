// Group features: antivoice, antisticker, antivideo, antigcstatus, antimention (4 modes),
// welcome, goodbye (per group) aur antidelete (owner ke account ke liye)
const store = require('../lib/store');
const { tinyBold } = require('../lib/font');
const { senderIsAdmin, botIsAdmin } = require('../lib/groupUtil');

const say = (sock, jid, text, extra = {}) => sock.sendMessage(jid, { text: tinyBold(text), ...extra });
const show = (v) => (!v || v === 'off' ? 'OFF' : v === true ? 'ON' : String(v).toUpperCase());

// Group + (admin ya owner) check. Fresh metadata ke saath.
async function groupGuard(ctx, { needBotAdmin = false } = {}) {
  const { sock, from, msg, isInstanceOwner } = ctx;
  if (!from.endsWith('@g.us')) {
    await say(sock, from, '❌ This command only works in groups.');
    return null;
  }
  let meta;
  try { meta = await sock.groupMetadata(from); } catch (e) {
    await say(sock, from, '❌ Could not fetch group info, please try again.');
    return null;
  }
  if (!isInstanceOwner && !senderIsAdmin(meta.participants, msg)) {
    await say(sock, from, '❌ Only group admins can use this command.');
    return null;
  }
  const botAdmin = botIsAdmin(meta.participants, sock);
  if (needBotAdmin && !botAdmin) {
    await say(sock, from, '❌ Please make the bot an admin first.');
    return null;
  }
  return { meta, botAdmin };
}

function modeCommand(name, field, title, what) {
  return {
    name,
    description: `${title} protection with modes: delete / warn / kick / off`,
    category: 'group',
    async execute(ctx) {
      const { sock, from, args, prefix } = ctx;
      const g = await groupGuard(ctx);
      if (!g) return;
      const gs = await store.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();

      if (!['off', 'on', 'delete', 'warn', 'kick'].includes(opt)) {
        return say(sock, from,
          `⚙️ ${title}\nCurrent mode: ${show(gs[field])}\n\n` +
          `• ${prefix}${name} delete — delete ${what}\n` +
          `• ${prefix}${name} warn — delete + warn (3 warnings = kick)\n` +
          `• ${prefix}${name} kick — delete + remove the user\n` +
          `• ${prefix}${name} off — disable`);
      }
      const mode = opt === 'off' ? false : opt === 'on' ? 'delete' : opt;
      await store.setGroupSettings(from, { [field]: mode });
      let text = `✅ ${title} is now set to ${show(mode)}.`;
      if (mode && !g.botAdmin) text += '\n\n⚠️ The bot is not an admin yet, so it cannot delete or remove anyone.';
      await say(sock, from, text);
    },
  };
}

function toggleCommand(name, field, title, desc) {
  return {
    name,
    description: desc,
    category: 'group',
    async execute(ctx) {
      const { sock, from, args, prefix } = ctx;
      const g = await groupGuard(ctx);
      if (!g) return;
      const gs = await store.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return say(sock, from, `${title} is currently ${show(!!gs[field])}.\nUsage: ${prefix}${name} on / ${prefix}${name} off`);
      }
      await store.setGroupSettings(from, { [field]: opt === 'on' });
      await say(sock, from, `✅ ${title} is now ${opt.toUpperCase()}.`);
    },
  };
}

module.exports = [
  modeCommand('antivoice', 'antivoice', 'Anti-voice', 'voice notes'),
  modeCommand('antisticker', 'antisticker', 'Anti-sticker', 'stickers'),
  modeCommand('antivideo', 'antivideo', 'Anti-video', 'videos'),
  modeCommand('antigcstatus', 'antigcstatus', 'Anti-group-status', 'group status posts (group stories)'),
  modeCommand('antimention', 'antimention', 'Anti-mention', 'status mentions of this group'),
  toggleCommand('welcome', 'welcomeOn', 'Welcome message', 'Welcome new members in this group (on/off)'),
  toggleCommand('goodbye', 'goodbyeOn', 'Goodbye message', 'Say goodbye when members leave this group (on/off)'),
  {
    name: 'antiedit',
    aliases: ['antiedited'],
    description: 'Notify when someone edits a message (group admins: this group, owner: private chats) on/off',
    category: 'moderation',
    async execute(ctx) {
      const { sock, from, args, prefix, botNumber, isInstanceOwner } = ctx;
      const opt = (args[0] || '').toLowerCase();
      const inGroup = from.endsWith('@g.us');
      let current;
      if (inGroup) {
        const g = await groupGuard(ctx);
        if (!g) return;
        current = (await store.getGroupSettings(from)).antieditOn;
      } else {
        if (!isInstanceOwner) return say(sock, from, '❌ Only the bot owner can use this command.');
        current = (await store.getInstanceSettings(botNumber)).antieditOn;
      }
      if (opt !== 'on' && opt !== 'off') {
        return say(sock, from, `✏️ Anti-edit is currently ${current ? 'ON' : 'OFF'}${inGroup ? ' in this group' : ' for your private chats'}.\nUsage: ${prefix}antiedit on / ${prefix}antiedit off`);
      }
      if (inGroup) await store.setGroupSettings(from, { antieditOn: opt === 'on' });
      else await store.setInstanceSettings(botNumber, { antieditOn: opt === 'on' });
      await say(sock, from, `✏️ Anti-edit is now ${opt.toUpperCase()}${inGroup ? ' in this group' : ' for your private chats'}.`);
    },
  },
  {
    // Purana combined command: ab do alag commands hain
    name: 'antistatus',
    description: 'Use .antimention or .antigcstatus',
    category: 'group',
    async execute({ sock, from, prefix }) {
      await say(sock, from, `ℹ️ This command is now split in two:\n• ${prefix}antimention — status that mentions the group\n• ${prefix}antigcstatus — group status (story) posts`);
    },
  },
  {
    // Ek hi switch, poore account ke liye. Deleted messages sirf self chat mein aate hain.
    name: 'antidelete',
    aliases: ['antidel'],
    description: 'Send deleted messages to your self chat (owner only, on/off)',
    category: 'moderation',
    async execute(ctx) {
      const { sock, from, args, prefix, botNumber, isInstanceOwner } = ctx;
      if (!isInstanceOwner) return say(sock, from, '❌ Only the bot owner can use this command.');
      const s = await store.getInstanceSettings(botNumber);
      const opt = (args[0] || '').toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return say(sock, from, `🛡️ Anti-delete is currently ${s.antideleteOn ? 'ON' : 'OFF'}.\nUsage: ${prefix}antidelete on / ${prefix}antidelete off`);
      }
      await store.setInstanceSettings(botNumber, { antideleteOn: opt === 'on' });
      await say(sock, from, opt === 'on'
        ? '🛡️ Anti-delete is now ON.\nDeleted messages from all chats will be sent to your self chat only.'
        : '🛡️ Anti-delete is now OFF.');
    },
  },
];
