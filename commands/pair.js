// .pair [number] — har user istemal kar sakta hai (bot private ho tab bhi).
// Number na dein to aap ka apna number lega. Code ek message mein, instructions alag message mein.
const config = require('../config');

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

module.exports = [
  {
    name: 'pair',
    aliases: ['pairing', 'paircode'],
    description: 'WhatsApp pairing code: .pair 923001234567 (number na dein to aap ka apna)',
    category: 'general',
    async execute(ctx) {
      const { sock, msg, from } = ctx;
      // Tag ke liye phone number wala JID (LID ki bajaye) pehle
      const senderJid = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid || from;
      const raw = (ctx.args || [])[0];
      // Number diya ho to wahi (galat ho to error); na diya ho to aap ka apna number
      let num = raw ? digits(raw) : digits(msg.key.participantAlt || (from.endsWith('@s.whatsapp.net') ? from : ''));
      if (num.length < 10 || num.length > 15) throw new Error('Number sahi nahi. Misal: .pair 923001234567');

      const mgr = require('../bot'); // lazy: circular import se bachne ke liye
      if (!mgr.ready) throw new Error('Node abhi start ho raha hai, thori dair baad try karein.');
      const result = await mgr.addInstance(num);

      // 1) sirf code
      await sock.sendMessage(from, { text: String(result.code) }, { quoted: msg });
      // 2) member ko tag + instructions
      await sock.sendMessage(from, {
        text:
          `@${digits(senderJid)} your pair is generated\n` +
          `WhatsApp kholein > Settings > Linked devices > Link a device > Link with phone number instead, ` +
          `phir upar wala code enter karein.`,
        mentions: [senderJid],
      });
    },
  },
];
