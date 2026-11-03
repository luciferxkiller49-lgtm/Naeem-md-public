const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * MongoDB Auth State for Baileys Multi-Device
 * Scoped by appId (1-10) and phone number
 */
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
          if (value) {
            keys[fullKey] = value;
          } else {
            delete keys[fullKey];
          }
          changed = true;
        }
      }

      if (changed) {
        try {
          const serializedKeys = JSON.parse(JSON.stringify(keys, BufferJSON.replacer));
          await collection.updateOne(
            { _id: id, appId: String(appId) },
            {
              $set: {
                keys: serializedKeys,
                updatedAt: new Date()
              }
            },
            { upsert: true }
          );
        } catch (err) {
          console.error(`[MONGO-AUTH] Failed to save keys for ${id}:`, err.message);
        }
      }
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

async function getAppSessions(collection, appId) {
  try {
    const docs = await collection.find({ appId: String(appId) }).toArray();
    return docs.map(d => d._id);
  } catch (err) {
    console.error(`[MONGO-AUTH] Error getting sessions for app ${appId}:`, err.message);
    return [];
  }
}

module.exports = {
  useMongoDBAuthState,
  getAppSessions
};
