// .groupprotection — ek hi command se saare anti-features ek sath ON/OFF karta hai:
// antilink, antivoice, antisticker, antivideo, antipic, antigcstatus, antimention
//
// Usage:
//   .groupprotection on              -> sab features "delete" mode mein ON ho jate hain
//   .groupprotection on warn         -> sab features "warn" mode mein ON
//   .groupprotection on kick         -> sab features "kick" mode mein ON
//   .groupprotection off             -> sab features OFF ho jate hain
const store = require('../lib/store');

const PROTECTED_FIELDS = [
  'antilink',
  'antivoice',
  'antisticker',
  'antivideo',
  'antipic',
  'antigcstatus',
  'antimention',
];

const VALID_MODES = ['delete', 'warn', 'kick'];

module.exports = [
  {
    name: 'groupprotection',
    aliases: ['gprotect', 'groupguard'],
    description: 'Saare anti-features (antilink, antivoice, antisticker, antivideo, antipic, antigcstatus, antimention) ek sath on/off karta hai',
    category: 'group',
    async execute(ctx) {
      const { sock, from, args, isInstanceOwner, isAdmin } = ctx;
      if (!from.endsWith('@g.us')) {
        return sock.sendMessage(from, { text: '❌ Ye command sirf group mein chalti hai.' });
      }
      if (!isInstanceOwner && !isAdmin) {
        return sock.sendMessage(from, { text: '❌ Sirf group admin ya bot owner ye command chala sakta hai.' });
      }

      const opt = (args[0] || '').toLowerCase();
      if (opt !== 'on' && opt !== 'off') {
        return sock.sendMessage(from, {
          text:
            `Usage:\n` +
            `• ${ctx.prefix}groupprotection on [delete|warn|kick] (default: delete)\n` +
            `• ${ctx.prefix}groupprotection off\n\n` +
            `Ye ek sath ON/OFF karega: ${PROTECTED_FIELDS.join(', ')}`,
        });
      }

      if (opt === 'off') {
        const updates = {};
        for (const f of PROTECTED_FIELDS) updates[f] = false;
        await store.setGroupSettings(from, updates);
        return sock.sendMessage(from, {
          text: `🛡️ Group protection OFF — ${PROTECTED_FIELDS.join(', ')} sab OFF kar diye gaye hain.`,
        });
      }

      const mode = (args[1] || 'delete').toLowerCase();
      if (!VALID_MODES.includes(mode)) {
        return sock.sendMessage(from, { text: `❌ Mode galat hai. Options: ${VALID_MODES.join(', ')}` });
      }

      const updates = {};
      for (const f of PROTECTED_FIELDS) updates[f] = mode;
      await store.setGroupSettings(from, updates);
      return sock.sendMessage(from, {
        text:
          `🛡️ Group protection ON (*${mode.toUpperCase()}* mode) — ye sab ON ho gaye hain:\n` +
          PROTECTED_FIELDS.map((f) => `• ${f}`).join('\n'),
      });
    },
  },
];
