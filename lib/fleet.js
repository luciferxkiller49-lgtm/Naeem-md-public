// Saare servers (Heroku apps) ka haal: har node apna "heartbeat" Mongo mein likhta hai, aur
// .botstatus / .botusers (sirf bot owner) us se aur `sessions` collection se poora hisaab dikhate hain.
// Kisi doosre node ka URL ya koi network call nahi chahiye.
const config = require('./../config');
const store = require('./store');
const { BOT_VERSION } = require('./version');

const BEAT_MS = 60 * 1000;
const ONLINE_WITHIN_MS = 150 * 1000; // 2.5 beats
const TZ = process.env.TIMEZONE || 'Asia/Karachi';
const TOTAL_SERVERS = Math.max(1, parseInt(process.env.TOTAL_SERVERS || '10', 10));

let db = null;
let manager = null;
let timer = null;

async function beat() {
  if (!db || !manager) return;
  try {
    const mem = process.memoryUsage();
    await db.collection('nodes').updateOne(
      { _id: `node-${config.APP_ID}` },
      {
        $set: {
          appId: String(config.APP_ID),
          version: BOT_VERSION,
          active: manager.getActiveCount(),
          saved: manager.instances.size,
          limit: config.MAX_LIMIT,
          rssMB: Math.round(mem.rss / 1048576),
          uptimeSec: Math.floor(process.uptime()),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (e) { /* heartbeat band bhi ho jaye to bot ka kaam nahi rukta */ }
}

function start(database, botManager) {
  db = database;
  manager = botManager;
  beat();
  timer = setInterval(beat, BEAT_MS);
  if (timer.unref) timer.unref();
}

const isLinked = (d) => !!(d?.creds?.registered || d?.creds?.me?.id);

/** Sab linked users: [{ number, appId, updatedAt, linkedAt }] */
async function users() {
  if (!db) return [];
  const docs = await db.collection('sessions')
    .find({}, { projection: { appId: 1, updatedAt: 1, 'creds.registered': 1, 'creds.me.id': 1 } })
    .toArray();
  const linked = docs.filter(isLinked).map((d) => ({ number: String(d._id), appId: String(d.appId || '?'), updatedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : 0, linkedAt: 0 }));

  if (store.collection && linked.length) {
    try {
      const rows = await store.collection
        .find({ _id: { $in: linked.map((u) => `instance:${u.number}`) } }, { projection: { 'data.linkedAt': 1 } })
        .toArray();
      const map = new Map(rows.map((r) => [String(r._id).replace('instance:', ''), Number(r.data?.linkedAt) || 0]));
      for (const u of linked) u.linkedAt = map.get(u.number) || 0;
    } catch (e) {}
  }
  return linked;
}

/** Har server ka haal + total */
async function servers() {
  await beat(); // is node ki apni halat taaza
  const list = await users();
  const beats = db ? await db.collection('nodes').find({}).toArray() : [];
  const byBeat = new Map(beats.map((b) => [String(b.appId), b]));
  const counts = new Map();
  for (const u of list) counts.set(u.appId, (counts.get(u.appId) || 0) + 1);

  const ids = new Set();
  for (let i = 1; i <= TOTAL_SERVERS; i++) ids.add(String(i));
  for (const k of counts.keys()) ids.add(k);
  for (const k of byBeat.keys()) ids.add(k);

  const now = Date.now();
  const rows = [...ids].sort((a, b) => Number(a) - Number(b)).map((id) => {
    const b = byBeat.get(id);
    const age = b?.updatedAt ? now - new Date(b.updatedAt).getTime() : null;
    return {
      id,
      users: counts.get(id) || 0,
      online: age !== null && age <= ONLINE_WITHIN_MS,
      lastBeatMs: age,
      active: b?.active ?? null,
      limit: b?.limit ?? config.MAX_LIMIT,
      version: b?.version || null,
      rssMB: b?.rssMB ?? null,
      uptimeSec: b?.uptimeSec ?? null,
    };
  });
  return { rows, total: list.length };
}

// ---- Formatting ----
function fmtAgo(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
const fmtDate = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

function statusText({ rows, total }) {
  const on = rows.filter((r) => r.online).length;
  const latest = rows.map((r) => r.version).filter(Boolean).sort().pop() || null; // sab se naya version jo kisi server ne bataya
  const capacity = rows.reduce((n, r) => n + (r.limit || 0), 0);
  const lines = [
    '📊 *BOT STATUS*',
    '',
    `👥 Total users: *${total}*`,
    `🖥️ Servers: 🟢 ${on} online / 🔴 ${rows.length - on} offline (total ${rows.length})`,
    `📦 Jagah: ${total} / ${capacity} bhari`,
    '',
  ];
  for (const r of rows) {
    if (r.online) {
      lines.push(`*Server #${r.id}* 🟢 — 👥 ${r.users} users (online abhi: ${r.active ?? '?'}) / ${r.limit}`);
      const ver = r.version ? `${r.version}${latest && r.version < latest ? ' ⚠️ purana code' : ''}` : 'version ?';
      lines.push(`      🧠 ${r.rssMB ?? '?'} MB • ⏱ ${fmtAgo((r.uptimeSec ?? 0) * 1000)} • 🏷 ${ver}`);
    } else {
      const seen = r.lastBeatMs == null ? 'koi signal nahi' : `aakhri signal ${fmtAgo(r.lastBeatMs)} pehle`;
      lines.push(`*Server #${r.id}* 🔴 — 👥 ${r.users} users (${seen})`);
    }
  }
  return lines.join('\n');
}

/** .botusers — chunks mein (WhatsApp ke lambe message se bachne ke liye) */
function usersChunks(list, serverId) {
  const now = Date.now();
  const rows = (serverId ? list.filter((u) => u.appId === String(serverId)) : list)
    .sort((a, b) => Number(a.appId) - Number(b.appId) || a.number.localeCompare(b.number));
  const head = `👥 *BOT USERS* — ${rows.length}${serverId ? ` (Server #${serverId})` : ` (total, ${new Set(rows.map((r) => r.appId)).size} server)`}\n`;
  const items = rows.map((u, i) => {
    const linked = u.linkedAt ? `${fmtDate(u.linkedAt)} (${fmtAgo(now - u.linkedAt)} se)` : 'purana — date record nahi';
    const last = u.updatedAt ? `${fmtAgo(now - u.updatedAt)} pehle` : '—';
    return `${i + 1}. +${u.number}  [S#${u.appId}]\n   🔗 ${linked}\n   🕒 aakhri activity: ${last}`;
  });
  const chunks = [];
  let cur = head;
  for (const it of items) {
    if ((cur + '\n' + it).length > 3000) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + it;
  }
  chunks.push(cur || head + '\n(koi user nahi)');
  return chunks;
}

module.exports = { start, beat, users, servers, statusText, usersChunks, fmtAgo };
