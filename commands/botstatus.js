// Owner-only: puri "server farm" (sab Heroku apps) ki health, user list, aur
// kisi ek number ki poori detail. Data do shared MongoDB collections se aata
// hai jo pehle se har app sync karta hai:
//   - capacity : har server ka LIVE count (har 60s mein heartbeat hota hai)
//   - sessions : har number ka record (kis appId/server par hai, kab se linked hai)
// Isi wajah se ye command kisi bhi server par chalayein, sab servers ka data
// dikhega — sirf "is waqt live hai ya nahi" sirf usi server ke liye pakka
// pata chalta hai jahan command chal rahi hai.
const store = require('../lib/store');
const { tinyBold } = require('../lib/font');
const { formatDuration } = require('../lib/uptime');

const ago = (date) => (date ? `${formatDuration(Date.now() - new Date(date).getTime())} ago` : 'n/a');

const state = (v) => (!v || v === 'off' ? '❌ OFF' : v === true ? '✅ ON' : `✅ ${String(v).toUpperCase()}`);

function isLinked(doc) {
  return !!(doc?.creds?.registered || doc?.creds?.me?.id);
}

async function sendChunked(ctx, lines, perChunk = 35) {
  for (let i = 0; i < lines.length; i += perChunk) {
    await ctx.sock.sendMessage(ctx.from, { text: lines.slice(i, i + perChunk).join('\n') });
    if (i + perChunk < lines.length) await new Promise((r) => setTimeout(r, 400));
  }
}

async function summary(ctx) {
  const col = ctx.botManager.sessionsCol;
  const capCol = ctx.botManager.db.collection('capacity');

  const [capDocs, allDocs] = await Promise.all([
    capCol.find({ _id: /^app/ }).toArray(),
    col.find({}, { projection: { 'creds.registered': 1, 'creds.me.id': 1, appId: 1 } }).toArray(),
  ]);

  capDocs.sort((a, b) => Number(a.appId) - Number(b.appId));
  const totalOnline = capDocs.reduce((sum, d) => sum + (d.count || 0), 0);
  const totalCapacity = capDocs.reduce((sum, d) => sum + (d.limit || 0), 0);
  const totalLinked = allDocs.filter(isLinked).length;

  const lines = [tinyBold('📊 Bot Network Status'), ''];
  lines.push(`🟢 Online now: ${tinyBold(String(totalOnline))} / ${totalCapacity}`);
  lines.push(`📋 Total linked (ever paired): ${tinyBold(String(totalLinked))}`);
  lines.push('', tinyBold('Servers:'));

  const STALE_MS = 3 * 60 * 1000; // heartbeat har 60s aata hai, 3 miss = shayad down
  for (const d of capDocs) {
    const stale = !d.updatedAt || Date.now() - new Date(d.updatedAt).getTime() > STALE_MS;
    const icon = stale ? '⚠️' : '🟢';
    lines.push(`${icon} Server ${d.appId}: ${d.count || 0}/${d.limit || 0}${stale ? ' (stale — shayad down)' : ''}`);
  }

  lines.push('', `Numbers ki poori list ke liye: ${tinyBold('.botusers')}`, `Kisi ek number ki detail: ${tinyBold('.status<number>')}`);
  await ctx.sock.sendMessage(ctx.from, { text: lines.join('\n') });
}

async function detail(ctx, rawNumber) {
  const number = String(rawNumber).replace(/[^0-9]/g, '');
  if (!number) return ctx.reply('❌ Sahi number dein, jaise: .status923001234567');

  const col = ctx.botManager.sessionsCol;
  const doc = await col.findOne({ _id: number });

  if (!doc || !isLinked(doc)) {
    return ctx.reply(`ℹ️ +${number} kisi bhi server par linked nahi mila.`);
  }

  const lines = [tinyBold(`📱 +${number}`), ''];
  lines.push(`🖥️ Server: ${tinyBold(doc.appId || '?')}`);
  lines.push(`🕐 Bot use kar raha hai: ${ago(doc.createdAt)} se`);
  lines.push(`🔄 Last update: ${ago(doc.updatedAt)}`);

  // Live socket sirf isi server par milega jahan ye number abhi connected hai
  const live = ctx.botManager.instances.get(number);
  if (live && live.status === 'online') {
    lines.push('', `🟢 ${tinyBold('Is server par ABHI online hai')}`);
    try {
      const groups = await live.sock.groupFetchAllParticipating();
      lines.push(`👥 Groups: ${Object.keys(groups).length}`);
    } catch (e) {
      lines.push('👥 Groups: pata nahi chal saka');
    }
    const cCount = live.contactsSeen?.size;
    lines.push(`📇 Contacts (ab tak sync hue): ${cCount ? cCount : 'abhi sync ho raha hai...'}`);
  } else {
    lines.push('', `📋 ${tinyBold('Is server par live nahi hai')} (DB record maujood hai — agar ye kisi aur server par chal raha hai, uske groups/contacts sirf usi server se mil sakte hain)`);
  }

  const s = await store.getInstanceSettings(number);
  lines.push('', tinyBold('⚙️ Features:'));
  lines.push(
    `Antidelete: ${state(s.antideleteOn)}`,
    `Antiedit: ${state(s.antieditOn)}`,
    `Anticall: ${state(s.antiCall)}`,
    `Autoread: ${state(s.autoRead)}`,
    `Autoreact: ${state(s.autoReact)}`,
    `Autotyping: ${state(s.autoTyping)}`,
    `Chatbot: ${state(s.chatbot)}`,
    `Away: ${state(s.awayEnabled)}`,
    `AFK: ${state(s.afk)}`,
  );
  lines.push('', `🌐 Mode: ${tinyBold(String(s.mode || 'public'))}`);

  await ctx.sock.sendMessage(ctx.from, { text: lines.join('\n') });
}

module.exports = [
  {
    name: 'botstatus',
    description: 'Owner only: sab servers ka total/online user count, ya (number diye jane par) ek number ki poori detail',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');
      if (ctx.args[0]) return detail(ctx, ctx.args[0]);
      return summary(ctx);
    },
  },
  {
    name: 'botusers',
    aliases: ['botuserlist'],
    description: 'Owner only: sab servers mein linked tamam numbers ki list (kaunsa server, kab se linked)',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isOwner) return ctx.reply('❌ Owner only command.');

      const col = ctx.botManager.sessionsCol;
      const docs = await col
        .find({}, { projection: { appId: 1, createdAt: 1, 'creds.registered': 1, 'creds.me.id': 1 } })
        .toArray();

      const linked = docs.filter(isLinked).sort((a, b) => (Number(a.appId) - Number(b.appId)) || (new Date(a.createdAt) - new Date(b.createdAt)));
      if (!linked.length) return ctx.reply('ℹ️ Abhi koi bhi number kisi server par linked nahi hai.');

      const lines = [tinyBold(`📋 Linked Numbers (${linked.length})`), ''];
      for (const d of linked) {
        const liveHere = ctx.botManager.instances.get(d._id)?.status === 'online';
        lines.push(`${liveHere ? '🟢' : '📱'} +${d._id} — Server ${d.appId || '?'} — ${ago(d.createdAt)} se`);
      }
      await sendChunked(ctx, lines);
    },
  },
];
