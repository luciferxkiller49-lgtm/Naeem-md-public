// Group admin commands: promote / demote (member ko admin banana / admin se hatana) aur
// mute / unmute, open / close (group mein sirf admin bolen ya sab).
// Member ka pata: tag/mention, kisi ke message par reply, ya number. Bot ko group admin hona zaroori.
const userOf = (j) => String(j || '').split('@')[0].split(':')[0];

function contextInfoOf(message) {
  const m = message || {};
  for (const k of Object.keys(m)) { const ci = m[k]?.contextInfo; if (ci) return ci; }
  return null;
}

function targetsOf(ctx) {
  const ci = contextInfoOf(ctx.msg?.message);
  const set = new Set();
  for (const j of ci?.mentionedJid || []) set.add(j);
  if (ci?.quotedMessage && ci.participant) set.add(ci.participant);
  for (const a of ctx.args || []) {
    if (/^\+?[0-9]{7,15}$/.test(String(a).replace(/[\s-]/g, ''))) set.add(`${String(a).replace(/[^0-9]/g, '')}@s.whatsapp.net`);
  }
  return [...set];
}

async function prereq(ctx) {
  if (!ctx.isGroup) return 'ℹ️ Ye command group mein likhein.';
  if (!(ctx.isAdmin || ctx.isOwner || ctx.isInstanceOwner)) return '❌ Sirf group admin ye command chala sakta hai.';
  if (!ctx.isBotAdmin) return '❌ Pehle bot ko group admin banayein.';
  return null;
}

function memberCommand(name, action, doneText, desc) {
  return {
    name,
    aliases: [],
    description: desc,
    category: 'group',
    async execute(ctx) {
      const err = await prereq(ctx);
      if (err) return ctx.reply(err);
      const list = targetsOf(ctx).filter((j) => userOf(j) !== userOf(ctx.sock.user?.id) && userOf(j) !== userOf(ctx.sock.user?.lid));
      if (!list.length) return ctx.reply(`ℹ️ Kisi member ko tag, mention, reply ya number se chunein.\nMisal: *${ctx.prefix}${name} @user*`);
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.from, list, action);
        return ctx.sock.sendMessage(ctx.from, {
          text: `✅ ${doneText}: ${list.map((j) => `@${userOf(j)}`).join(' ')}`,
          mentions: list,
        });
      } catch (e) {
        return ctx.reply(`❌ Ye kaam nahi ho saka: ${e.message}`);
      }
    },
  };
}

function settingCommand(name, setting, doneText, desc) {
  return {
    name,
    aliases: [],
    description: desc,
    category: 'group',
    async execute(ctx) {
      const err = await prereq(ctx);
      if (err) return ctx.reply(err);
      try {
        await ctx.sock.groupSettingUpdate(ctx.from, setting);
        return ctx.reply(`✅ ${doneText}.`);
      } catch (e) {
        return ctx.reply(`❌ Group setting nahi badli: ${e.message}`);
      }
    },
  };
}

module.exports = [
  memberCommand('promote', 'promote', 'Admin bana diya gaya', 'Member ko group admin banata hai (tag/reply/number)'),
  memberCommand('demote', 'demote', 'Admin se member bana diya gaya', 'Admin ko member banata hai (tag/reply/number)'),
  settingCommand('mute', 'announcement', 'Group band: ab sirf admin message kar sakte hain', 'Group mute: sirf admin message kar sakein'),
  settingCommand('close', 'announcement', 'Group band: ab sirf admin message kar sakte hain', 'Group band karta hai (sirf admin message)'),
  settingCommand('unmute', 'not_announcement', 'Group khul gaya: ab sab message kar sakte hain', 'Group unmute: sab message kar sakein'),
  settingCommand('open', 'not_announcement', 'Group khul gaya: ab sab message kar sakte hain', 'Group khol deta hai (sab message kar sakein)'),
];
