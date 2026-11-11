// .fixsession        — is group mein bot jawab nahi de raha / messages decrypt nahi ho rahe: is group ki kharab keys saaf (mild)
// .fixsession full   — upar wala + is group ke members ke pairwise sessions bhi (agar mild se theek na ho)
// Sirf bot ka owner. Baaki groups par koi asar nahi.
module.exports = [
  {
    name: 'fixsession',
    aliases: ['fixgroup', 'fixkeys'],
    description: 'Is group ke kharab encryption keys saaf karta hai (bot jawab na de to). .fixsession full = zyada gehra',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('ℹ️ Ye command jis group mein masla hai usi group mein likhein.');
      if (!ctx.isOwner) return ctx.reply('❌ Ye command sirf bot owner ke liye hai.');
      const full = String(ctx.args?.[0] || '').toLowerCase() === 'full';

      let participants = [];
      if (full) {
        try { participants = (await ctx.sock.groupMetadata(ctx.from)).participants || []; } catch (e) {}
      }
      let r;
      try {
        r = await ctx.fixGroupSession(ctx.from, { full, participants });
      } catch (e) {
        return ctx.reply(`❌ Fix nahi ho saka: ${e.message}`);
      }
      const parts = [`${r.senderKeys} sender key`, `${r.memory} memory`];
      if (full) parts.push(`${r.sessions} member session`);
      return ctx.reply(
        `✅ Is group ki ${parts.join(', ')} saaf ho gayin.\n\n` +
        `Ab group mein koi bhi ek message bhejein, phir 1 se 2 minute baad command try karein — keys WhatsApp khud naye bana leta hai.` +
        (full ? '' : `\nAgar phir bhi jawab na aaye to *${ctx.prefix}fixsession full* chalayein.`)
      );
    },
  },
];
