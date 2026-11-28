/**
 * MongoDB Settings Store
 * Replaces data/persist.json with collection 'settings'
 */
// Mongo ka Binary / Buffer / Uint8Array — kisi bhi shakal se sahi bytes (Binary ka internal buffer bada bhi ho sakta hai)
function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (x && x.buffer && ArrayBuffer.isView(x.buffer)) {
    const u8 = x.buffer;
    const len = typeof x.length === 'function' ? x.length() : (typeof x.position === 'number' ? x.position : u8.byteLength);
    return Buffer.from(u8.buffer, u8.byteOffset, Math.min(len, u8.byteLength));
  }
  return Buffer.from(x);
}

class SettingsStore {
  constructor() {
    this.collection = null;
    this.menuCol = null;
    this.claims = null;
    this.cache = new Map();
  }

  init(db) {
    this.collection = db.collection('settings');
    // Menu ki photo/video alag collection mein (pehle instance settings ke andar thi aur RAM cache mein hamesha rehti thi)
    this.menuCol = db.collection('menu_media');
    // Chhote "pehle main" claims (welcome/goodbye ek hi member ko ek hi baar). TTL index purane claims khud hata deta hai.
    this.claims = db.collection('claims');
    this.claims.createIndex({ at: 1 }, { expireAfterSeconds: 120 }).catch(() => {});
  }

  /**
   * true = is process ne ye kaam "claim" kar liya (kaam karo); false = kisi aur bot/server ne pehle hi le liya (chhor do).
   * Mongo ke unique _id se: sab servers par ek hi jawab. Mongo na ho to true (kaam rukna nahi chahiye).
   */
  async claim(key) {
    if (!this.claims) return true;
    try {
      await this.claims.insertOne({ _id: String(key), at: new Date() });
      return true;
    } catch (err) {
      if (err && err.code === 11000) return false;
      return true;
    }
  }

  // --- Instance Settings ---
  async getInstanceSettings(number) {
    const key = `instance:${number}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const defaultSettings = {
      prefix: '.',
      mode: 'private',
      autoRead: false,
      autoTyping: false,
      chatbot: false,
      antiSpam: true,
      // FIX: these two were missing entirely. antidel.js/antiedit.js in a
      // private chat had nothing to check against, so antidelete/antiedit
      // could never be turned off in the owner's own DMs. Added here with
      // the same default (true/on) as the group-level defaults below, so
      // behaviour doesn't change for anyone until they explicitly toggle it.
      // Antidelete ab sirf owner ke account par ek hi switch hai (default OFF)
      antideleteOn: false,
      antieditOn: false
    };

    if (!this.collection) return defaultSettings;

    try {
      const doc = await this.collection.findOne({ _id: key });
      const settings = doc ? { ...defaultSettings, ...doc.data } : defaultSettings;
      if (settings.menuMedia) this._migrateMenuMedia(number, settings);
      this.cache.set(key, settings);
      return settings;
    } catch (err) {
      console.error(`[STORE] Error fetching instance settings for ${number}:`, err.message);
      return defaultSettings;
    }
  }

  async setInstanceSettings(number, newSettings) {
    const key = `instance:${number}`;
    const current = await this.getInstanceSettings(number);
    const updated = { ...current, ...newSettings };
    this.cache.set(key, updated);

    // Sirf wahi fields likhte hain jo change hue (dotted $set). Poora "data" overwrite nahi karte,
    // taake kisi default/adhoori load se pehle ki saved settings (relink ke baad bhi) kho na jayen.
    if (this.collection) {
      const $set = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(newSettings)) $set[`data.${k}`] = v;
      await this.collection.updateOne({ _id: key }, { $set }, { upsert: true });
    }
    return updated;
  }

  // --- Group Settings ---
  async getGroupSettings(groupId) {
    const key = `group:${groupId}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const defaultSettings = {
      antilink: false,
      antieditOn: false,
      // Modes: false (off) | 'delete' | 'warn' | 'kick'
      antivoice: false,
      antisticker: false,
      antivideo: false,
      antipic: false,
      antigcstatus: false,
      antimention: false,
      welcomeOn: true,  // default ON: sab groups mein (group admin .welcome off se band kar sakta hai)
      goodbyeOn: true,
      welcomeMessage: 'Welcome @user to @group!',
      goodbyeMessage: 'Goodbye @user, we will miss you!'
    };

    if (!this.collection) return defaultSettings;

    try {
      const doc = await this.collection.findOne({ _id: key });
      const settings = doc ? { ...defaultSettings, ...doc.data } : defaultSettings;
      this.cache.set(key, settings);
      return settings;
    } catch (err) {
      console.error(`[STORE] Error fetching group settings for ${groupId}:`, err.message);
      return defaultSettings;
    }
  }

  async setGroupSettings(groupId, newSettings) {
    const key = `group:${groupId}`;
    const current = await this.getGroupSettings(groupId);
    const updated = { ...current, ...newSettings };
    this.cache.set(key, updated);

    // Sirf wahi fields likhte hain jo change hue (dotted $set): welcome/goodbye ya anti settings
    // kisi purani/default cache se overwrite nahi hoti, aur restart ke baad bhi wahi rehti hain.
    if (this.collection) {
      const $set = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(newSettings)) $set[`data.${k}`] = v;
      await this.collection.updateOne({ _id: key }, { $set }, { upsert: true });
    }
    return updated;
  }

  // --- Menu media (photo/video) ---
  // Purane format (settings ke andar base64) ko ek baar nayi collection mein bhej kar settings se hata dete hain,
  // taake RAM cache mein badi file na rahe.
  _migrateMenuMedia(number, settings) {
    const old = settings.menuMedia;
    delete settings.menuMedia; // cache mein bhari data na rahe
    if (!old || !old.data || !this.menuCol) return;
    this.menuCol.updateOne(
      { _id: String(number) },
      { $setOnInsert: { _id: String(number), type: old.type, mimetype: old.mimetype, data: Buffer.from(old.data, 'base64'), at: new Date() } },
      { upsert: true }
    ).then(() => this.collection.updateOne({ _id: `instance:${number}` }, { $unset: { 'data.menuMedia': '' } }))
      .catch((e) => console.error('[STORE] menu media migrate failed:', e.message));
  }

  async setMenuMedia(number, media) {
    if (!this.menuCol) throw new Error('Database abhi ready nahi');
    await this.menuCol.updateOne(
      { _id: String(number) },
      { $set: { type: media.type, mimetype: media.mimetype, data: Buffer.from(media.data, 'base64'), at: new Date() } },
      { upsert: true }
    );
    // purana (settings ke andar wala) agar ho to hata do
    await this.collection.updateOne({ _id: `instance:${number}` }, { $unset: { 'data.menuMedia': '' } }).catch(() => {});
    const c = this.cache.get(`instance:${number}`);
    if (c) delete c.menuMedia;
  }

  async getMenuMedia(number) {
    if (!this.menuCol) return null;
    try {
      const d = await this.menuCol.findOne({ _id: String(number) });
      if (!d || !d.data) return null;
      return { type: d.type, mimetype: d.mimetype, data: toBuffer(d.data).toString('base64') };
    } catch (e) {
      console.error('[STORE] menu media read failed:', e.message);
      return null;
    }
  }

  /** Naye pairing par developer wala default menu wapas (user chahe to .setbotdp se apna laga le) */
  async clearMenuMedia(number) {
    if (this.menuCol) await this.menuCol.deleteOne({ _id: String(number) }).catch(() => {});
    if (this.collection) await this.collection.updateOne({ _id: `instance:${number}` }, { $unset: { 'data.menuMedia': '' } }).catch(() => {});
    const c = this.cache.get(`instance:${number}`);
    if (c) delete c.menuMedia;
  }

  // --- Intro Text ---

  async getIntro(number) {
    const key = `intro:${number}`;
    if (this.cache.has(key)) return this.cache.get(key);

    if (!this.collection) return null;
    const doc = await this.collection.findOne({ _id: key });
    const text = doc ? doc.text : null;
    this.cache.set(key, text);
    return text;
  }

  async setIntro(number, text) {
    const key = `intro:${number}`;
    this.cache.set(key, text);

    if (this.collection) {
      await this.collection.updateOne(
        { _id: key },
        { $set: { _id: key, text, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  }
}

module.exports = new SettingsStore();
