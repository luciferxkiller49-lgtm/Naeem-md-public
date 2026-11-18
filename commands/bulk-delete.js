// .dellink  — jin messages mein link ho (status post ke andar ka link bhi) unhe delete for everyone
// .delstory — saare group-status (story) posts delete for everyone
//
// Kahan chalta hai:
//   • Group mein            -> sirf usi group par (group admin ya bot owner chalaye, bot ko admin hona chahiye)
//   • "Message yourself"    -> `.dellink all` / `.delstory all` likhne par bot ke SAARE groups par (jahan bot admin hai)
//   • Kisi aur ki private chat mein (sirf owner) -> sirf usi chat par, aur WhatsApp ke rules ke hisaab se sirf
//     owner ke apne bheje hue messages hi "everyone" ke liye delete ho sakte hain
//
// NOTE: bot sirf wahi messages delete kar sakta hai jo usne online rehte hue dekhe hon (RAM mein yaad rehte hain,
// restart par khali). Bot ke aane se PEHLE ke messages WhatsApp bot ko nahi deta.
const bulkCache = require('../lib/bulkCache');
const deleteGuard = require('../lib/deleteGuard');
const { botIsAdmin } = require('../lib/groupUtil');

const DELAY_MS = parseInt(process.env.BULK_DELETE_DELAY_MS || '250', 10); // WhatsApp ko spam na lage
const running = new Set(); // ek chat mein ek waqt mein ek hi bulk delete
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];

function isSelfChat(ctx) {
  if (ctx.isGroup) return false;
  const me = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map(userPart);
  return me.includes(userPart(ctx.from));
}

async function deleteKeys(ctx, chatId, keys) {
  let done = 0;
  for (const key of keys) {
    deleteGuard.mark(key.id);
    try { await ctx.sock.sendMessage(chatId, { delete: key }); done++; } catch (e) {}
    await sleep(DELAY_MS);
  }
  return done;
}

function bulkDelete({ name, aliases, description, take, noun, otherNoun, otherCmd, otherCount }) {
  return {
    name,
    aliases,
    description,
    category: 'moderation',
    async execute(ctx) {
      const wantAll = (ctx.args || []).some((a) => String(a).toLowerCase() === 'all');
      const self = isSelfChat(ctx);

      // ---- Kahan kahan chalega ----
      let targets; // [chatId, ...]
      if (ctx.isGroup) {
        if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Sirf group admin ye command chala sakta hai.');
        if (!ctx.isBotAdmin) return ctx.reply('❌ Pehle bot ko group admin banayein, tabhi messages delete ho sakte hain.');
        targets = [ctx.from];
      } else if (self) {
        if (!wantAll) {
          return ctx.reply(`ℹ️ Ye apni chat hai. Saare groups ke liye likhein: .${name} all\nKisi ek group ke liye wahi command us group mein likhein.`);
        }
        targets = (await bulkCache.allChatIds()).filter((j) => j.endsWith('@g.us'));
      } else {
        if (!ctx.isOwner) return ctx.reply('❌ Ye command yahan sirf bot owner chala sakta hai.');
        targets = [ctx.from]; // sirf isi chat ka
      }

      const lockKey = ctx.isGroup || !self ? ctx.from : 'ALL';
      if (running.has(lockKey)) return ctx.reply('⏳ Delete pehle se chal raha hai, khatam hone dein.');
      running.add(lockKey);

      try {
        let total = 0; let done = 0; let skipped = 0; let groups = 0;
        for (const chatId of targets) {
          // "all" mein har group mein bot ka admin hona jaanch lete hain (baqi groups chhor dete hain, un ke records waise hi rehte hain)
          if (self && chatId.endsWith('@g.us')) {
            try {
              const meta = await ctx.sock.groupMetadata(chatId);
              if (!botIsAdmin(meta.participants || [], ctx.sock)) { skipped++; continue; }
            } catch (e) { skipped++; continue; }
          }
          const keys = await take(chatId);
          if (!keys.length) continue;
          total += keys.length;
          done += await deleteKeys(ctx, chatId, keys);
          groups++;
        }

        if (!total) {
          const { links, statuses } = bulkCache.counts(ctx.from);
          const other = otherCount({ links, statuses });
          const hint = !self && other ? `\n💡 Is chat mein ${other} ${otherNoun} record hain — unke liye .${otherCmd} chalayein.` : '';
          return ctx.reply(`ℹ️ Koi ${noun} record nahi hai jo delete ho sake.\n(Bot sirf wahi messages delete kar sakta hai jo usne online rehte hue dekhe hon.)${hint}`);
        }
        const where = self ? ` (${groups} group(s))` : '';
        const extra = skipped ? `\n⚠️ ${skipped} group(s) chhor diye (bot wahan admin nahi).` : '';
        return ctx.reply(`✅ ${done}/${total} ${noun} delete ho gaye${where}.${extra}`);
      } finally {
        running.delete(lockKey);
      }
    },
  };
}

module.exports = [
  bulkDelete({
    name: 'dellink',
    aliases: ['linkdel', 'delalllink', 'delallinks', 'delalllinks', 'delallurls'],
    description: 'Link wale messages (status post ke andar ka link bhi) ek sath delete (for everyone)',
    take: bulkCache.takeLinkKeys,
    noun: 'link message(s)',
    otherNoun: 'status post(s) (bina link ke)',
    otherCmd: 'delstory',
    otherCount: ({ links, statuses }) => Math.max(0, statuses - links),
  }),
  bulkDelete({
    name: 'delstory',
    aliases: ['delallstatus', 'delallstatuses', 'delallstories', 'delallgcstatus'],
    description: 'Saare group-status (story) posts ek sath delete (for everyone)',
    take: bulkCache.takeStatusKeys,
    noun: 'status post(s)',
    otherNoun: 'link wale message(s)',
    otherCmd: 'dellink',
    otherCount: ({ links, statuses }) => links,
  }),
];
