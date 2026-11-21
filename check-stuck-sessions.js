// check-stuck-sessions.js
//
// MAQSAD: "sessions" collection scan karta hai aur un numbers ko dikhata hai jo
// "registered: true" hain lekin jis node (appId) ke naam par hain wo node is
// waqt OFFLINE hai — matlab koi live socket us doc ko use nahi kar sakta,
// ye ek "ghost" / stuck document hai (saveCreds ke upsert:true resurrect bug
// ki wajah se bana hua).
//
// SIRF REPORT karta hai by default — kuch bhi delete nahi karta jab tak
// --delete <number> na diya jaye.
//
// CHALANE KA TAREEQA (Heroku se, kisi bhi ek node/app par):
//   heroku run node check-stuck-sessions.js --app <tumhara-heroku-app-name>
//
// Sirf report dekhna ho:
//   heroku run node check-stuck-sessions.js --app <app>
//
// Ek specific number ka stuck doc delete karna ho (poori tasalli ke baad):
//   heroku run node check-stuck-sessions.js --app <app> -- --delete 923001234567
//
// NOTE: Isko MONGODB_URI wale config/env ke sath hi chalana hai (jahan bot
// khud chalta hai), taake wahi database mile jisme "sessions" collection hai.

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'naeembot';
const ONLINE_WITHIN_MS = 150 * 1000; // fleet.js jaisa hi threshold (2.5 heartbeat)

async function main() {
  if (!MONGODB_URI) {
    console.error('FATAL: MONGODB_URI env var set nahi hai. Isko Heroku Config Vars wale environment mein chalao.');
    process.exit(1);
  }

  const deleteIdx = process.argv.indexOf('--delete');
  const deleteNumber = deleteIdx !== -1 ? String(process.argv[deleteIdx + 1] || '').replace(/[^0-9]/g, '') : null;

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Har node ka latest heartbeat (fleet.js isi collection mein likhta hai)
  const nodeBeats = await db.collection('nodes').find({}).toArray();
  const now = Date.now();
  const onlineAppIds = new Set(
    nodeBeats
      .filter((b) => b.updatedAt && now - new Date(b.updatedAt).getTime() <= ONLINE_WITHIN_MS)
      .map((b) => String(b.appId))
  );

  const sessions = await db.collection('sessions')
    .find({}, { projection: { appId: 1, updatedAt: 1, 'creds.registered': 1, 'creds.me.id': 1 } })
    .toArray();

  const fmtAgo = (ms) => {
    if (ms == null) return '?';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const ghosts = [];
  const live = [];
  const unlinked = [];

  for (const d of sessions) {
    const number = String(d._id);
    const appId = String(d.appId || '?');
    const registered = !!(d.creds?.registered || d.creds?.me?.id);
    const ageMs = d.updatedAt ? now - new Date(d.updatedAt).getTime() : null;
    const nodeOnline = onlineAppIds.has(appId);

    if (!registered) {
      unlinked.push({ number, appId, ageMs });
    } else if (!nodeOnline) {
      // registered hai lekin jis node ke naam ye doc hai wo is waqt heartbeat nahi bhej raha -> ghost
      ghosts.push({ number, appId, ageMs });
    } else {
      live.push({ number, appId, ageMs });
    }
  }

  console.log('================ SESSION REPORT ================');
  console.log(`Total session docs: ${sessions.length}`);
  console.log(`Online nodes (heartbeat ${ONLINE_WITHIN_MS / 1000}s ke andar): ${[...onlineAppIds].sort().join(', ') || '(koi nahi)'}`);
  console.log('');

  console.log(`--- LIKELY GHOST / STUCK (${ghosts.length}) — registered:true hai lekin node #appId offline hai ---`);
  for (const g of ghosts) console.log(`  +${g.number}  [Node #${g.appId}]  last update ${fmtAgo(g.ageMs)} pehle`);
  if (!ghosts.length) console.log('  (koi nahi mila)');
  console.log('');

  console.log(`--- NOT REGISTERED (${unlinked.length}) — adhoori/purani pairing (purgeUnlinkedSessions already inhe node restart par saaf karta hai) ---`);
  for (const u of unlinked) console.log(`  +${u.number}  [Node #${u.appId}]  last update ${fmtAgo(u.ageMs)} pehle`);
  console.log('');

  console.log(`--- LIVE / OK (${live.length}) — registered hai aur node online hai ---`);
  console.log(`  (list chhoti rakhi hai, bas count: ${live.length})`);
  console.log('==================================================');

  if (deleteNumber) {
    const target = ghosts.find((g) => g.number === deleteNumber);
    if (!target) {
      console.log(`\n--delete ${deleteNumber}: Ye number GHOST list mein nahi mila (ya to live hai ya already saaf hai). Kuch delete nahi kiya gaya — pehle upar wali ghost list dubara check karein.`);
    } else {
      await db.collection('sessions').deleteOne({ _id: deleteNumber, appId: target.appId });
      console.log(`\n✅ Deleted stuck doc for +${deleteNumber} (Node #${target.appId}). Ab ye number kisi bhi node se dobara .pair kar sakta hai.`);
    }
  } else if (ghosts.length) {
    console.log(`\nIn mein se jo number dobara pair karwana hai, use delete karne ke liye:`);
    console.log(`  heroku run node check-stuck-sessions.js --app <app> -- --delete <number>`);
  }

  await client.close();
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
