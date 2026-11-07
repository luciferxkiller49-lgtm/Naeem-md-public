const store = require('./store');

async function handleAntiedit(sock, msg) {
  if (!msg.message?.protocolMessage || msg.message.protocolMessage.type !== 14) {
    return false;
  }

  const editProto = msg.message.protocolMessage;
  const targetKey = editProto.key;
  if (!targetKey) return false;

  const chatJid = targetKey.remoteJid;
  const isGroup = chatJid?.endsWith('@g.us');

  if (isGroup) {
    const groupSettings = await store.getGroupSettings(chatJid);
    if (!groupSettings.antieditOn) return false;
  } else {
    // FIX: same private-chat scope fix as lib/antidel.js
    const botNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
    if (botNumber) {
      const instanceSettings = await store.getInstanceSettings(botNumber);
      if (!instanceSettings.antieditOn) return false;
    }
  }

  const sender = targetKey.participant || targetKey.remoteJid;
  const newText = editProto.editedMessage?.conversation ||
                 editProto.editedMessage?.extendedTextMessage?.text;

  if (!newText) return false;

  const notice = `✏️ *[EDITED MESSAGE DETECTED]*\n` +
    `👤 *User:* @${sender.split('@')[0]}\n` +
    `📝 *New Text:* ${newText}`;

  try {
    await sock.sendMessage(chatJid, {
      text: notice,
      mentions: [sender]
    });
    return true;
  } catch (err) {
    console.error('[ANTIEDIT] Error handling edit:', err.message);
  }

  return false;
}

module.exports = {
  handleAntiedit
};
