const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * MongoDB Auth State for Baileys Multi-Device
 * Scoped by appId (1-10) and phone number
 */
const flushers = new Set();
let shutdownHooked = false;
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const done = async () => {
    try { await Promise.race([Promise.all([...flushers].map((f) => f())), new Promise((r) => setTimeout(r, 8000))]); } catch (e) {}
    process.exit(0);
  };
  process.once('SIGTERM', done);
  process.once('SIGINT', done);
}

async function useMongoDBAuthState(collection, number, appId) {
  const cleanNumber = String(number).replace(/[^0-9]/g, '');
  const id = cleanNumber;

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
        keys = JSON.parse(JSON.stringify(existing.keys), BufferJSON.reviver);
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
      await collection.updateOne(
        { _id: id, appId: String(appId) },
        { $set: { keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)), resetToken, updatedAt: new Date() } }
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

  // Writes ek ek karke hoti hain aur hamesha LATEST snapshot save hota hai (purani snapshot nayi ko overwrite nahi kar sakti)
  let writing = null;
  let pendingWrite = false;
  const flushKeys = () => {
    if (writing) { pendingWrite = true; return writing; }
    writing = (async () => {
      do {
        pendingWrite = false;
        try {
          const serializedKeys = JSON.parse(JSON.stringify(keys, BufferJSON.replacer));
          await collection.updateOne(
            { _id: id, appId: String(appId) },
            { $set: { keys: serializedKeys, updatedAt: new Date() } },
            { upsert: true }
          );
        } catch (err) {
          console.error(`[MONGO-AUTH] Failed to save keys for ${id}:`, err.message);
        }
      } while (pendingWrite);
      writing = null;
    })();
    return writing;
  };
  flushers.add(flushKeys);
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
          changed = true;
        }
      }
      if (changed) await flushKeys();
    }
  };

  return {
    state: {
      creds,
      keys: keyStorage
    },
    saveCreds,
    deleteSession: async () => {
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
