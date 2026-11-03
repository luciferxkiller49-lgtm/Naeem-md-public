const axios = require('axios');
const store = require('./store');

/**
 * Handle AI Auto-Chat if chatbot mode is enabled for this instance or chat
 */
async function handleChatbot(sock, msg, from, sender, text, botNumber) {
  if (!text || text.startsWith('.')) return false;

  const instanceSettings = await store.getInstanceSettings(botNumber);
  if (!instanceSettings.chatbot) return false;

  // Don't auto-reply to bot's own messages
  if (msg.key.fromMe) return false;

  try {
    // Free AI conversational API with fallback
    const res = await axios.get(`https://api.simsimi.net/v2/?text=${encodeURIComponent(text)}&lc=en`, {
      timeout: 5000
    }).catch(() => null);

    let reply = res?.data?.success;
    if (!reply) {
      reply = `Hello @${sender.split('@')[0]}! I received your message: "${text}". How can I help you today?`;
    }

    await sock.sendMessage(from, {
      text: reply,
      mentions: [sender]
    }, { quoted: msg });

    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  handleChatbot
};
