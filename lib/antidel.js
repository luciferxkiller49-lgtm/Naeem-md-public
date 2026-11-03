const NodeCache = require('node-cache');
const store = require('./store');

// Cache storing messages for 2 hours (7200 seconds)
const messageCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

/**
 * Store message in cache for possible antidelete retrieval
 */
function cacheMessage(msg) {
  if (!msg || !msg.key || !msg.key.id) return;
  const id = msg.key.id;
  messageCache.set(id, msg);
}

/**
 * Handle message revocation (delete for everyone)
 */
async function handleAntidelete(sock, update) {
  const { key } = update;
  if (!key || !key.id) return;

  const cached = messageCache.get(key.id);
  if (!cached) return;

  const chatJid = key.remoteJid;
  const isGroup = chatJid.endsWith('@g.us');

  if (isGroup) {
    const groupSettings = await store.getGroupSettings(chatJid);
    if (!groupSettings.antidelete) return;
  }

  const sender = cached.key.participant || cached.key.remoteJid;
  const senderNum = sender.split('@')[0];
  const time = new Date().toLocaleTimeString();

  const msgContent = cached.message;
  if (!msgContent) return;

  const alertHeader = `🚨 *[ANTIDELETE DETECTED]*\n` +
    `👤 *Sender:* @${senderNum}\n` +
    `🕒 *Time:* ${time}\n` +
    `📍 *Chat:* ${isGroup ? 'Group' : 'Private'}\n` +
    `────────────────────`;

  try {
    await sock.sendMessage(chatJid, {
      text: alertHeader,
      mentions: [sender]
    });

    // Forward original message content
    if (msgContent.conversation || msgContent.extendedTextMessage) {
      const text = msgContent.conversation || msgContent.extendedTextMessage.text;
      await sock.sendMessage(chatJid, { text: `💬 *Deleted Text:*\n${text}` });
    } else {
      // Forward image/sticker/audio/video
      await sock.sendMessage(chatJid, {
        forward: cached
      });
    }
  } catch (err) {
    console.error('[ANTIDELETE] Failed to repost deleted message:', err.message);
  }
}

module.exports = {
  cacheMessage,
  handleAntidelete
};
