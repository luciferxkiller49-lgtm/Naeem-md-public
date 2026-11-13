// .kick — group se member remove karta hai. Tag/mention, kisi ke message ko reply, ya number se.
// Group admin ya bot owner chala sakta hai. Bot ko group admin hona chahiye.
const userOf = (j) => String(j || '').split('@')[0].split(':')[0];

function contextInfoOf(message) {
  const m = message || {};
  for (const k of Object.keys(m)) { const ci = m[k]?.contextInfo; if (ci) return ci; }
  return null;
}

module.exports = [
  {
    name: 'kick',
    aliases: [],
    description: 'Group se member remove karta hai: .kick @tag, ya kisi ke message par reply, ya .kick 923xxxxxxxxx',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Ye command sirf group mein chalta hai.');
      if (!(ctx.isAdmin || ctx.isOwner || ctx.isInstanceOwner)) return ctx.reply('❌ Sirf group admin ya bot owner ye command chala sakta hai.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Pehle bot ko group admin banayein.');

      const ci = contextInfoOf(ctx.msg?.message);
      const targets = new Set();
      for (const j of ci?.mentionedJid || []) targets.add(j);
      if (ci?.quotedMessage && ci.participant) targets.add(ci.participant);
      for (const a of ctx.args || []) {
        const digits = String(a).replace(/[^0-9]/g, '');
        if (/^\+?[0-9]{7,15}$/.test(String(a).replace(/[\s-]/g, ''))) targets.add(`${digits}@s.whatsapp.net`);
      }

      // Apne aap ko, bot ko aur owner ko kabhi remove nahi karte
      const protectedNums = new Set([
        ...[ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map(userOf),
        String(ctx.botNumber || '').replace(/[^0-9]/g, ''),
        String(ctx.config?.OWNER_NUMBER || '').replace(/[^0-9]/g, ''),
      ]);
      const list = [...targets].filter((j) => !protectedNums.has(userOf(j)));
      if (!list.length) return ctx.reply('ℹ️ Kisi member ko tag, mention, reply ya number se chunein.\nMisal: .kick @user  |  .kick 923001234567');

      let res;
      try { res = await ctx.sock.groupParticipantsUpdate(ctx.from, list, 'remove'); }
      catch (e) { return ctx.reply(`❌ Remove nahi ho saka: ${e.message}`); }

      const removed = []; const failed = [];
      list.forEach((jid, i) => {
        const st = String(res?.[i]?.status ?? '200');
        (st.startsWith('2') ? removed : failed).push(jid);
      });
      const tag = (j) => `@${userOf(j)}`;
      const parts = [];
      if (removed.length) parts.push(`✅ Group se nikal diya: ${removed.map(tag).join(' ')}`);
      if (failed.length) parts.push(`❌ Nahi nikal saka (shayad admin hai): ${failed.map(tag).join(' ')}`);
      return ctx.sock.sendMessage(ctx.from, { text: parts.join('\n'), mentions: [...removed, ...failed] });
    },
  },
];
