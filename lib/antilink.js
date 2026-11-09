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
      // FIX: har action ke baad jo "⚠️ warning/removed" text message bhejta
      // tha, user ne khas tor par mana kiya hai — message sirf chup chaap
      // delete (aur zaroorat par kick) hota hai, koi reminder text nahi
      // jata. Delete/kick ka asal kaam (link hatana, 3 warning par nikalna)
      // waisa hi rehta hai, bas text bandh hai.
      if (groupSettings.antilink === 'kick') {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } else if (groupSettings.antilink === 'warn') {
        const userKey = `${from}:${sender}`;
        const count = (warnings.get(userKey) || 0) + 1;
        warnings.set(userKey, count);

        if (count >= 3) {
          warnings.delete(userKey);
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
        }
      }
      // Mode 'delete' ya true: sirf delete, koi message nahi.
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
