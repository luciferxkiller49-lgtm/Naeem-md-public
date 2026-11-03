const config = require('../config');

class SafetyManager {
  constructor() {
    this.lastExecuted = new Map();
  }

  /**
   * Check if user is on cooldown
   */
  isRateLimited(senderJid) {
    const now = Date.now();
    const last = this.lastExecuted.get(senderJid) || 0;
    const cooldown = config.COMMAND_COOLDOWN_MS;

    if (now - last < cooldown) {
      return true;
    }
    this.lastExecuted.set(senderJid, now);
    return false;
  }

  /**
   * Safe asynchronous sleep utility to prevent burst messages
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Safe send delay for group status / broadcasts
   */
  async safeDelay() {
    await this.sleep(config.GC_STATUS_DELAY_MS);
  }
}

module.exports = new SafetyManager();
