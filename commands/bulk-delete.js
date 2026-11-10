// .dellink / .delstory — group mein jitne link wale messages ya group-status (story) posts bot ne dekhe hain,
// sab ek command se "delete for everyone". Bot ko group admin hona chahiye.
// NOTE: bot sirf wahi messages delete kar sakta hai jo usne online rehte hue dekhe hon (RAM mein yaad rehte hain,
// restart par khali). Bot ke group mein aane se PEHLE ke messages WhatsApp bot ko nahi deta.
const bulkCache = require('../lib/bulkCache');

const DELAY_MS = parseInt(process.env.BULK_DELETE_DELAY_MS || '250', 10); // WhatsApp ko spam na lage
const running = new Set(); // ek group mein ek waqt mein ek hi bulk delete

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bulkDelete({ name, aliases, description, take, noun }) {
  return {
    name,
    aliases,
    description,
    category: 'moderation',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Ye command sirf group mein chalta hai.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Sirf group admin ye command chala sakta hai.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Pehle bot ko group admin banayein, tabhi messages delete ho sakte hain.');
      if (running.has(ctx.from)) return ctx.reply('⏳ Is group mein delete pehle se chal raha hai, khatam hone dein.');

      const keys = take(ctx.from);
      if (!keys.length) {
        return ctx.reply(`ℹ️ Koi ${noun} record nahi hai jo delete ho sake.\n(Bot sirf wahi messages delete kar sakta hai jo usne online rehte hue dekhe hon.)`);
      }

      running.add(ctx.from);
      try {
        await ctx.reply(`🧹 ${keys.length} ${noun} delete kiye ja rahe hain...`);
        let done = 0;
        for (const key of keys) {
          try { await ctx.sock.sendMessage(ctx.from, { delete: key }); done++; } catch (e) {}
          await sleep(DELAY_MS);
        }
        await ctx.reply(`✅ ${done}/${keys.length} ${noun} delete ho gaye.`);
      } finally {
        running.delete(ctx.from);
      }
    },
  };
}

module.exports = [
  bulkDelete({
    name: 'dellink',
    aliases: ['delalllink', 'delallinks', 'delalllinks', 'delallurls'],
    description: 'Group ke tamam link wale messages ek sath delete (for everyone)',
    take: bulkCache.takeLinkKeys,
    noun: 'link message(s)',
  }),
  bulkDelete({
    name: 'delstory',
    aliases: ['delallstatus', 'delallstatuses', 'delallstories', 'delallgcstatus'],
    description: 'Group ke tamam group-status (story) posts ek sath delete (for everyone)',
    take: bulkCache.takeStatusKeys,
    noun: 'status post(s)',
  }),
];
