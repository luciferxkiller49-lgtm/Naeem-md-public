const store = require('./store');

const WHATSAPP_LINK_REGEX = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;
const ALL_LINK_REGEX = /(https?:\/\/[^\s]+)/gi;

const warnings = new Map();

/**
 * Handle Antilink moderation for incoming message
 */
async function handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin) {
  if (!isGroup || isSenderAdmin) return false;

  const groupSettings = await store.getGroupSettings(from);
  if (!groupSettings.antilink) return false;

  const text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption || 
               msg.message?.videoMessage?.caption || '';

  if (!text) return false;

  const hasLink = groupSettings.antilink === 'all' 
    ? ALL_LINK_REGEX.test(text) 
    : WHATSAPP_LINK_REGEX.test(text);

  if (!hasLink) return false;

  console.log(`[ANTILINK] Detected forbidden link from ${sender} in group ${from}`);

  if (isBotAdmin) {
    try {
      // 1. Delete message
      await sock.sendMessage(from, { delete: msg.key });

      // 2. Action based on antilink mode
      if (groupSettings.antilink === 'kick') {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, {
          text: `⚠️ @${sender.split('@')[0]} has been kicked for posting links.`,
          mentions: [sender]
        });
      } else if (groupSettings.antilink === 'warn') {
        const userKey = `${from}:${sender}`;
        const count = (warnings.get(userKey) || 0) + 1;
        warnings.set(userKey, count);

        if (count >= 3) {
          warnings.delete(userKey);
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🚫 @${sender.split('@')[0]} was warned 3 times and has now been removed.`,
            mentions: [sender]
          });
        } else {
          await sock.sendMessage(from, {
            text: `⚠️ Warning [${count}/3]: @${sender.split('@')[0]}, links are not allowed in this group!`,
            mentions: [sender]
          });
        }
      } else {
        // Mode 'delete' or true
        await sock.sendMessage(from, {
          text: `⚠️ @${sender.split('@')[0]}, sending links is not allowed!`,
          mentions: [sender]
        });
      }
      return true;
    } catch (err) {
      console.error('[ANTILINK] Failed to moderate:', err.message);
    }
  }

  return false;
}

module.exports = {
  handleAntilink
};
