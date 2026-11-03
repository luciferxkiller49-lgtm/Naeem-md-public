/**
 * Helpers for WhatsApp Newsletters / Channels
 */
class NewsletterManager {
  /**
   * Follow a newsletter/channel
   */
  async follow(sock, newsletterJid) {
    if (typeof sock.newsletterFollow === 'function') {
      return await sock.newsletterFollow(newsletterJid);
    }
  }

  /**
   * Unfollow a newsletter
   */
  async unfollow(sock, newsletterJid) {
    if (typeof sock.newsletterUnfollow === 'function') {
      return await sock.newsletterUnfollow(newsletterJid);
    }
  }

  /**
   * Mute / Unmute newsletter
   */
  async mute(sock, newsletterJid, mute = true) {
    if (typeof sock.newsletterMute === 'function') {
      return await sock.newsletterMute(newsletterJid, mute);
    }
  }

  /**
   * React to newsletter message
   */
  async react(sock, newsletterJid, serverId, reaction = '❤️') {
    if (typeof sock.newsletterReactMessage === 'function') {
      return await sock.newsletterReactMessage(newsletterJid, serverId, reaction);
    }
  }
}

module.exports = new NewsletterManager();
