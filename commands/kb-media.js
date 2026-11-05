const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = [
  {
    name: 'save',
    description: 'Kisi status (ya kisi bhi message) ko reply karke isi chat mein save kar deta hai',
    execute: async ({ sock, msg, from }) => {
      const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted) {
        return sock.sendMessage(from, { text: 'Reply to a status (or any message) with .save.' });
      }

      const target =
        quoted.viewOnceMessageV2Extension?.message ||
        quoted.viewOnceMessageV2?.message ||
        quoted.viewOnceMessage?.message ||
        quoted;

      try {
        if (target.imageMessage || target.videoMessage) {
          const buffer = await downloadMediaMessage(
            { key: msg.key, message: target },
            'buffer',
            {},
            { logger: console, reuploadRequest: sock.updateMediaMessage }
          );
          const caption = target.imageMessage?.caption || target.videoMessage?.caption || '';
          if (target.imageMessage) {
            await sock.sendMessage(from, { image: buffer, caption });
          } else {
            await sock.sendMessage(from, { video: buffer, caption });
          }
        } else if (target.audioMessage) {
          const buffer = await downloadMediaMessage(
            { key: msg.key, message: target },
            'buffer',
            {},
            { logger: console, reuploadRequest: sock.updateMediaMessage }
          );
          await sock.sendMessage(from, { audio: buffer, mimetype: target.audioMessage.mimetype || 'audio/mp4' });
        } else {
          const text = target.conversation || target.extendedTextMessage?.text;
          if (!text) return sock.sendMessage(from, { text: '❌ Nothing to save from that message.' });
          await sock.sendMessage(from, { text });
        }
      } catch (err) {
        console.error('save command error:', err.message);
        await sock.sendMessage(from, { text: '❌ Could not save that.' });
      }
    },
  },
];