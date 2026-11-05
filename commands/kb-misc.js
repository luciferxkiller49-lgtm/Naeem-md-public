const store = require('../lib/store');
const rootConfig = require('../config');

module.exports = [
  {
    name: 'report',
    description: 'Bot developer ko koi issue/bug report karta hai',
    async execute({ sock, from, msg, args }) {
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .report <apna issue likhein>' });
      const devJid = `${String(rootConfig.OWNER_NUMBER).replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      const sender = msg.key.participant || msg.key.remoteJid;
      try {
        await sock.sendMessage(devJid, { text: `📩 *New Report*\nFrom: @${sender.split('@')[0]}\nChat: ${from}\n\n${text}`, mentions: [sender] });
        await sock.sendMessage(from, { text: 'Report sent to the developer.' });
      } catch {
        await sock.sendMessage(from, { text: 'Could not send the report.' });
      }
    },
  },
  {
    name: 'afk',
    description: 'AFK status (group mein mention hone par auto-reply)',
    async execute({ sock, from, args, botNumber, isInstanceOwner }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      if (args[0]?.toLowerCase() === 'off') {
        await store.setInstanceSettings(botNumber, { afk: false });
        return sock.sendMessage(from, { text: 'AFK is off.' });
      }
      const reason = args.join(' ') || 'Away right now';
      await store.setInstanceSettings(botNumber, { afk: true, afkReason: reason, afkSince: Date.now() });
      return sock.sendMessage(from, { text: `AFK is on.\nReason: "${reason}"` });
    },
  },
];
