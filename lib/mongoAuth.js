const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * MongoDB Auth State for Baileys Multi-Device
 * Scoped by appId (1-10) and phone number
 */
const flushers = new Map(); // number -> flushNow (har number ka sirf latest; purane instance ka closure RAM se nikal jata hai)
let shutdownHooked = false;
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const done = async () => {
    try { await Promise.race([Promise.all([...flushers.values()].map((f) => f())), new Promise((r) => setTimeout(r, 8000))]); } catch (e) {}
    process.exit(0);
  };
  process.once('SIGTERM', done);
  process.once('SIGINT', done);
}

// Baileys key id (e.g. "session-923001234567.0") mein '.' hota hai, aur Mongo
// update path mein '.' ka matlab "nested field" hota hai. Isay fullwidth dot
// (U+FF0E) se badal kar Mongo field-path mein mehfooz banate hain; asal
// in-memory object (RAM) mein original naam hi rehta hai.
const encodeFieldKey = (k) => k.replace(/\./g, '\uFF0E');
const decodeFieldKey = (k) => k.replace(/\uFF0E/g, '.');

async function useMongoDBAuthState(collection, number, appId) {
  const cleanNumber = String(number).replace(/[^0-9]/g, '');
  const id = cleanNumber;

  // Isi number ka purana instance (reconnect) agar abhi keys likhna baaki rakhta hai to pehle wo likh do,
  // warna naya instance Mongo se purani keys utha leta (debounce ki wajah se).
  const prevFlush = flushers.get(id);
  if (prevFlush) { try { await prevFlush(); } catch (e) {} }

  let existing = await collection.findOne({ _id: id, appId: String(appId) });

  let creds;
  let keys = {};

  if (existing && existing.creds) {
    try {
      creds = JSON.parse(JSON.stringify(existing.creds), BufferJSON.reviver);
    } catch (e) {
      creds = initAuthCreds();
    }
    if (existing.keys) {
      try {
        const rawKeys = JSON.parse(JSON.stringify(existing.keys), BufferJSON.reviver);
        for (const k of Object.keys(rawKeys)) keys[decodeFieldKey(k)] = rawKeys[k];
      } catch (e) {
        keys = {};
      }
    }
  } else {
    creds = initAuthCreds();
    keys = {};
    await collection.updateOne(
      // FIX: filter was `{ _id: id }` only. Since `_id` is unique, if a
      // document with this same phone number already existed under a
      // DIFFERENT appId (e.g. moved/re-paired to another of the 10 apps,
      // or a panel bug double-submitted a pairing), this upsert would match
      // that OTHER app's document and silently overwrite its appId and
      // creds — effectively stealing/breaking that app's session. Filtering
      // on both _id AND appId means this only ever creates a fresh doc or
      // updates this app's own doc.
      { _id: id, appId: String(appId) },
      {
        $set: {
          _id: id,
          appId: String(appId),
          creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
          keys: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  // Kharab Signal sessions ek baar saaf karna (Heroku Config Var: RESET_SIGNAL_SESSIONS=<koi bhi naya value>)
  const resetToken = process.env.RESET_SIGNAL_SESSIONS;
  if (resetToken && (!existing || existing.resetToken !== resetToken)) {
    let removed = 0;
    for (const k of Object.keys(keys)) {
      if (k.startsWith('session-') || k.startsWith('sender-key-memory-')) { delete keys[k]; removed++; }
    }
    try {
      const encoded = {};
      for (const k of Object.keys(keys)) encoded[encodeFieldKey(k)] = keys[k];
      await collection.updateOne(
        { _id: id, appId: String(appId) },
        { $set: { keys: JSON.parse(JSON.stringify(encoded, BufferJSON.replacer)), resetToken, updatedAt: new Date() } }
      );
      console.log(`[MONGO-AUTH] Cleared ${removed} signal sessions for ${id} (token ${resetToken}).`);
    } catch (e) { console.error('[MONGO-AUTH] session reset failed:', e.message); }
  }

  const saveCreds = async () => {
    try {
      const serializedCreds = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
      await collection.updateOne(
        { _id: id, appId: String(appId) },
        {
          $set: {
            creds: serializedCreds,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error(`[MONGO-AUTH] Failed to save creds for ${id}:`, err.message);
    }
  };

  // FIX (asli "late reply" wajah): pehle har flush poori `keys` object
  // (jo har session/group ke saath hamesha barhti rehti hai — kabhi chhoti
  // nahi hoti) dobara text mein badal kar poori ki poori Mongo mein likhti
  // thi — har single incoming/outgoing message par. Jitni purani/badi chat
  // history, utna bada ye object, aur JSON.stringify ek hi CPU thread par
  // chalta hai — is se Node ka event loop thora der ke liye block ho jata
  // aur sab numbers ke jawab peeche reh jate. Ab sirf wahi keys jo is batch
  // mein badli/hati hain unhe track karte hain, aur sirf unhi ko Mongo mein
  // $set/$unset karte hain — chahe `keys` object mein kitni bhi purani
  // entries kyun na hon, likhne wala payload hamesha chhota rehta hai.
  let dirty = new Set();
  let writing = null;
  let pendingWrite = false;
  const flushKeys = () => {
    if (writing) { pendingWrite = true; return writing; }
    writing = (async () => {
      do {
        pendingWrite = false;
        const batch = dirty;
        dirty = new Set();
        if (batch.size === 0) break;

        const setOps = {};
        const unsetOps = {};
        for (const fullKey of batch) {
          const field = `keys.${encodeFieldKey(fullKey)}`;
          if (Object.prototype.hasOwnProperty.call(keys, fullKey)) {
            setOps[field] = JSON.parse(JSON.stringify(keys[fullKey], BufferJSON.replacer));
          } else {
            unsetOps[field] = '';
          }
        }
        setOps.updatedAt = new Date();

        try {
          const update = { $set: setOps };
          if (Object.keys(unsetOps).length) update.$unset = unsetOps;
          await collection.updateOne({ _id: id, appId: String(appId) }, update, { upsert: true });
        } catch (err) {
          console.error(`[MONGO-AUTH] Failed to save keys for ${id}:`, err.message);
          // dobara koshish ke liye wapas dirty mein daal dein
          for (const fullKey of batch) dirty.add(fullKey);
        }
      } while (pendingWrite || dirty.size);
      writing = null;
    })();
    return writing;
  };

  // SPEED: pehle har key-change par Mongo ka intezar hota tha (har incoming message aur har reply
  // Atlas ke round-trip tak ruka rehta tha). Ab keys RAM mein foran update hoti hain aur Mongo mein
  // KEYS_FLUSH_MS (default 1.5s) ke andar ek batch mein likhi jati hain. Shutdown (SIGTERM) par
  // foran flush hota hai (hookShutdown).
  const FLUSH_MS = parseInt(process.env.KEYS_FLUSH_MS || '1500', 10);
  let flushTimer = null;
  let closed = false;
  const scheduleFlush = () => {
    if (closed || flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushKeys().catch(() => {}); }, FLUSH_MS);
  };
  const flushNow = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    return flushKeys();
  };
  flushers.set(id, flushNow);
  hookShutdown();

  const keyStorage = {
    get: async (type, ids) => {
      const data = {};
      for (const keyId of ids) {
        const fullKey = `${type}-${keyId}`;
        if (keys[fullKey]) {
          let value = keys[fullKey];
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[keyId] = value;
        }
      }
      return data;
    },
    set: async (data) => {
      let changed = false;
      for (const category in data) {
        for (const keyId in data[category]) {
          const value = data[category][keyId];
          const fullKey = `${category}-${keyId}`;
          if (value) keys[fullKey] = value;
          else delete keys[fullKey];
          dirty.add(fullKey);
          changed = true;
        }
      }
      if (changed) scheduleFlush();
    }
  };

  return {
    state: {
      creds,
      keys: keyStorage
    },
    saveCreds,
    deleteSession: async () => {
      closed = true; // logout ke baad koi pending flush purana doc dobara na bana de
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      dirty = new Set();
      if (flushers.get(id) === flushNow) flushers.delete(id);
      await collection.deleteOne({ _id: id, appId: String(appId) });
    }
  };
}

// Sirf wahi numbers jo sach mein WhatsApp se link ho chuke hain (registered ya me.id maujood)
async function getAppSessions(collection, appId) {
  try {
    const docs = await collection
      .find({ appId: String(appId) }, { projection: { 'creds.registered': 1, 'creds.me.id': 1 } })
      .toArray();
    return docs.filter((d) => d.creds?.registered || d.creds?.me?.id).map((d) => d._id);
  } catch (err) {
    console.error(`[MONGO-AUTH] Error getting sessions for app ${appId}:`, err.message);
    return [];
  }
}

// Startup par: jo sessions kabhi link hi nahi hue (galat number / adhoori pairing) unhe database se hata dena.
// Warna har restart par wo baar baar connect hone ki koshish karte hain aur bot ko slow karte hain.
async function purgeUnlinkedSessions(collection, appId) {
  try {
    const docs = await collection
      .find({ appId: String(appId) }, { projection: { 'creds.registered': 1, 'creds.me.id': 1 } })
      .toArray();
    const dead = docs.filter((d) => !(d.creds?.registered || d.creds?.me?.id)).map((d) => d._id);
    if (dead.length) {
      await collection.deleteMany({ _id: { $in: dead }, appId: String(appId) });
      console.log(`[MONGO-AUTH] Removed ${dead.length} unlinked session(s): ${dead.join(', ')}`);
    }
    return dead;
  } catch (err) {
    console.error('[MONGO-AUTH] purgeUnlinkedSessions failed:', err.message);
    return [];
  }
}

module.exports = {
  useMongoDBAuthState,
  getAppSessions,
  purgeUnlinkedSessions
};
