// Group status (story) post karne ka helper. gcstatus aur fuck dono isi ko istemal karte hain.
const crypto = require('crypto');
const { generateWAMessageContent, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

async function postGroupStatus(sock, groupJid, payload) {
  const content = await generateWAMessageContent(payload, { upload: sock.waUploadToServer, logger: console });
  const secret = crypto.randomBytes(32);
  const full = generateWAMessageFromContent(
    groupJid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: { message: { ...content, messageContextInfo: { messageSecret: secret } } },
    },
    { userJid: sock.user.id }
  );
  await sock.relayMessage(groupJid, full.message, { messageId: full.key.id });
  // Bot ka apna post ab .delstory ki list mein bhi aata hai (pehle skip ho jata tha)
  try {
    const me = sock.user?.id;
    require('./bulkCache').record(groupJid, {
      key: { remoteJid: groupJid, id: full.key.id, fromMe: true, participant: me },
      message: full.message,
    });
  } catch (e) { /* record fail ho to post pe asar na ho */ }
  return full.key.id;
}

module.exports = { postGroupStatus };
