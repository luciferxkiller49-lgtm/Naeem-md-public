// .kickall  — group admin / bot owner: group ke sab members (admins, bot aur owner ke alawa) ek saath remove.
//             Ghalati se na ho, isliye confirm zaroori: ".kickall yes"
// .acceptall — group admin: group ki sab pending join requests ek saath accept.
// Dono ke liye bot ko group admin hona zaroori hai.
const config = require('../config');

const userOf = (j) => String(j || '').split('@')[0].split(':')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 20;
const GAP_MS = Math.max(500, parseInt(process.env.GROUP_BATCH_GAP_MS || '2000', 10));
const running = new Set();

function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function checkAdminPrereq(ctx) {
  if (!ctx.isGroup) return 'ℹ️ Ye command group mein likhein.';
  if (!(ctx.isAdmin || ctx.isOwner || ctx.isInstanceOwner)) return '❌ Sirf group admin ye command chala sakta hai.';
  if (!ctx.isBotAdmin) return '❌ Pehle bot ko group admin banayein.';
  return null;
}

module.exports = [
  {
    name: 'kickall',
    aliases: [],
    description: 'Group ke sab members ek saath remove (admins ko chhod kar). Confirm: .kickall yes',
    category: 'group',
    async execute(ctx) {
      const err = await checkAdminPrereq(ctx);
      if (err) return ctx.reply(err);
      const word = String((ctx.args || [])[0] || '').toLowerCase();
      if (!['yes', 'confirm', 'haan'].includes(word)) {
        return ctx.reply(`⚠️ Ye group ke sab members (admins ke alawa) nikal dega.\nConfirm karne ke liye likhein: *${ctx.prefix}kickall yes*`);
      }
      if (running.has(ctx.from)) return ctx.reply('⏳ Kickall pehle se chal raha hai.');

      let meta;
      try { meta = await ctx.sock.groupMetadata(ctx.from); }
      catch (e) { return ctx.reply(`❌ Group ki maloomat nahi mili: ${e.message}`); }

      const protectedNums = new Set([
        ...[ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map(userOf),
        userOf(config.OWNER_NUMBER),
      ]);
      const targets = (meta.participants || []).filter((p) => {
        if (p.admin) return false;
        const nums = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(userOf);
        return !nums.some((n) => protectedNums.has(n));
      }).map((p) => p.id);

      if (!targets.length) return ctx.reply('ℹ️ Koi member remove karne ke liye nahi mila (sab admin hain).');

      running.add(ctx.from);
      try {
        await ctx.reply(`🧹 ${targets.length} members nikale ja rahe hain...`);
        let removed = 0; let failed = 0;
        for (const batch of chunks(targets, BATCH)) {
          try {
            const res = await ctx.sock.groupParticipantsUpdate(ctx.from, batch, 'remove');
            for (const r of res || []) (String(r?.status ?? '200').startsWith('2') ? removed++ : failed++);
          } catch (e) { failed += batch.length; }
          await sleep(GAP_MS);
        }
        return ctx.reply(`✅ ${removed} members nikal diye.${failed ? `\n⚠️ ${failed} nahi nikal sake (shayad admin ya bot ki power kam hai).` : ''}`);
      } finally {
        running.delete(ctx.from);
      }
    },
  },
  {
    name: 'acceptall',
    aliases: [],
    description: 'Group ki sab pending join requests ek saath accept',
    category: 'group',
    async execute(ctx) {
      const err = await checkAdminPrereq(ctx);
      if (err) return ctx.reply(err);
      let list;
      try { list = await ctx.sock.groupRequestParticipantsList(ctx.from); }
      catch (e) { return ctx.reply(`❌ Join requests nahi mil sakin: ${e.message}`); }
      const jids = (list || []).map((x) => x.jid || x.lid || x.id).filter(Boolean);
      if (!jids.length) return ctx.reply('ℹ️ Is group mein koi pending join request nahi hai.');

      let ok = 0; let fail = 0;
      for (const batch of chunks(jids, BATCH)) {
        try {
          const res = await ctx.sock.groupRequestParticipantsUpdate(ctx.from, batch, 'approve');
          for (const r of res || []) (String(r?.status ?? '200').startsWith('2') ? ok++ : fail++);
        } catch (e) { fail += batch.length; }
        await sleep(GAP_MS);
      }
      return ctx.reply(`✅ ${ok} join requests accept ho gayi.${fail ? `\n⚠️ ${fail} accept nahi ho sakin.` : ''}`);
    },
  },
];
