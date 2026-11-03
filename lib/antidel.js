const NodeCache = require('node-cache');
const store = require('./store');

const messageCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

function cacheMessage(msg) {
  if (!msg || !msg.key || !msg.key.id) return;
  const id = msg.key.id;
  messageCache.set(id, msg);
}

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
  } else {
    // FIX: private chats had no on/off check at all before — antidelete
    // could never be disabled by the owner in their own DMs. sock.user.id
    // is this instance's own WhatsApp JID (e.g. "923001234567:5@s.whatsapp.net"),
    // so we strip it down to digits and look up that number's instance setting.
    const botNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
    if (botNumber) {
      const instanceSettings = await store.getInstanceSettings(botNumber);
      if (!instanceSettings.antidelete) return;
    }
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

    if (msgContent.conversation || msgContent.extendedTextMessage) {
      const text = msgContent.conversation || msgContent.extendedTextMessage.text;
      await sock.sendMessage(chatJid, { text: `💬 *Deleted Text:*\n${text}` });
    } else {
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
