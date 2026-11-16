// .pair [number] — har user istemal kar sakta hai (bot private ho tab bhi).
// Number ke saath country code na ho to bot Pakistan maan leta hai (03xx -> 923xx, 3xx -> 923xx).
// Ek hi message mein: member ka tag, "your pair is generated", aur pairing code wala template.
const config = require('../config');

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

function normalizeNumber(raw) {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '92' + d.slice(1);
  else if (d.length === 10 && d.startsWith('3')) d = '92' + d;
  return d;
}

const TEMPLATE = [
  '╔═══════════════════╗',
  '⚡ 𝐇𝐎𝐖 𝐓𝐎 𝐂𝐎𝐍𝐍𝐄𝐂𝐓 𝐁𝐎𝐓 ⚡',
  '╚═══════════════════╝',
  '➤ *Open WhatsApp*➤ *Setting*',
  '➤ *Linked Devices*',
  '➤ *Select Link with phone number*',
  '➤ *Paste the generated code below.*',
  '',
  '╭─「 🔐 𝐘𝐎𝐔𝐑 𝐋𝐈𝐍𝐊 𝐂𝐎𝐃𝐄 」',
  '│ 𝐂𝐎𝐃𝐄  :  "{{PAIRING_CODE}}"',
  '╰────────────────',
].join('\n');

const pairCmd = {
  name: 'pair',
  aliases: ['pairing', 'paircode'],
  description: 'WhatsApp pairing code: .pair 923001234567 ya .pair 03001234567 (number na dein to aap ka apna)',
  category: 'general',
  async execute(ctx) {
    const { sock, msg, from } = ctx;
    // Tag ke liye phone number wala JID (LID ki bajaye) pehle
    const senderJid = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid || from;
    const raw = (ctx.args || [])[0];
    const num = normalizeNumber(raw || msg.key.participantAlt || (from.endsWith('@s.whatsapp.net') ? from : ''));
    if (!/^\d{11,15}$/.test(num)) {
      throw new Error(raw
        ? 'Sahi number likhein, country code ke saath. Misal: .pair 923001234567 ya .pair 03001234567'
        : 'Apna number nahi mila. Misal: .pair 923001234567');
    }

    const mgr = require('../bot'); // lazy: circular import se bachne ke liye
    if (!mgr.ready) throw new Error('Node abhi start ho raha hai, thori dair baad try karein.');
    const result = await mgr.addInstance(num);

    const body = TEMPLATE.replace('{{PAIRING_CODE}}', String(result.code));
    await sock.sendMessage(from, {
      text: `@${digits(senderJid)} your pair is generated\n\n${body}`,
      mentions: [senderJid],
    }, { quoted: msg });
  },
};

module.exports = [pairCmd];
module.exports.normalizeNumber = normalizeNumber;
