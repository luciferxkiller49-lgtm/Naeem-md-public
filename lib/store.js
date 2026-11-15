/**
 * MongoDB Settings Store
 * Replaces data/persist.json with collection 'settings'
 */
class SettingsStore {
  constructor() {
    this.collection = null;
    this.cache = new Map();
  }

  init(db) {
    this.collection = db.collection('settings');
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

    if (this.collection) {
      await this.collection.updateOne(
        { _id: key },
        { $set: { _id: key, data: updated, updatedAt: new Date() } },
        { upsert: true }
      );
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

    if (this.collection) {
      await this.collection.updateOne(
        { _id: key },
        { $set: { _id: key, data: updated, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    return updated;
  }

  // --- Intro Text ---
  async setMenuMedia(number, media) {
    return this.setInstanceSettings(number, { menuMedia: media });
  }

  async getMenuMedia(number) {
    const s = await this.getInstanceSettings(number);
    return s?.menuMedia || null;
  }

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
