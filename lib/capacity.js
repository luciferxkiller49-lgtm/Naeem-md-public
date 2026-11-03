const config = require('../config');

/**
 * Capacity tracker for this Heroku App instance
 * Synchronizes count to MongoDB collection 'capacity'
 */
class CapacityManager {
  constructor() {
    this.collection = null;
    this.activeCount = 0;
    this.limit = config.MAX_LIMIT;
    this.appId = config.APP_ID;
    this.heartbeatInterval = null;
  }

  init(db) {
    this.collection = db.collection('capacity');
    this.sync();

    // FIX: previously this only synced when the count CHANGED (a number
    // connects/disconnects). An idle-but-perfectly-alive server could go
    // hours without a new sync, but so could a server that just CRASHED —
    // from the panel's side (reading updatedAt to judge freshness) the two
    // looked identical. A heartbeat every 60s means updatedAt always
    // reflects "this process was alive N seconds ago", so the panel's
    // staleness check can actually tell a dead node from a quiet one.
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => this.sync(), 60000);
  }

  setCount(count) {
    this.activeCount = count;
    this.sync();
  }

  increment() {
    this.activeCount++;
    this.sync();
  }

  decrement() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.sync();
  }

  isFull() {
    return this.activeCount >= this.limit;
  }

  getStatus() {
    return {
      appId: this.appId,
      count: this.activeCount,
      limit: this.limit,
      available: !this.isFull()
    };
  }

  async sync() {
    if (!this.collection) return;
    try {
      const payload = {
        count: this.activeCount,
        limit: this.limit,
        appId: this.appId,
        updatedAt: new Date()
      };

      await Promise.all([
        this.collection.updateOne(
          { _id: `app${this.appId}` },
          { $set: { _id: `app${this.appId}`, ...payload } },
          { upsert: true }
        ),
        this.collection.updateOne(
          { _id: `server${this.appId}` },
          { $set: { _id: `server${this.appId}`, ...payload } },
          { upsert: true }
        )
      ]);
    } catch (err) {
      console.error(`[CAPACITY] Failed to sync capacity to MongoDB:`, err.message);
    }
  }
}

module.exports = new CapacityManager();
