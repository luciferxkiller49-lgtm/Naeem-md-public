// .antipic — group mein images (photos) control karta hai.
// Baaki anti-features jaisa hi: off | delete | warn | kick
const store = require('../lib/store');

const VALID_MODES = ['off', 'delete', 'warn', 'kick'];

module.exports = [
  {
    name: 'antipic',
    aliases: ['antiimage', 'antiphoto'],
    description: 'Group mein images control karta hai: off | delete | warn | kick',
    category: 'group',
    async execute(ctx) {
      const { sock, from, args, isInstanceOwner, isAdmin } = ctx;
      if (!from.endsWith('@g.us')) {
        return sock.sendMessage(from, { text: '❌ Ye command sirf group mein chalti hai.' });
      }
      if (!isInstanceOwner && !isAdmin) {
        return sock.sendMessage(from, { text: '❌ Sirf group admin ya bot owner ye command chala sakta hai.' });
      }

      const mode = (args[0] || '').toLowerCase();
      if (!VALID_MODES.includes(mode)) {
        return sock.sendMessage(from, { text: `Usage: .antipic off | delete | warn | kick` });
      }

      await store.setGroupSettings(from, { antipic: mode === 'off' ? false : mode });
      return sock.sendMessage(from, { text: `🖼️ antipic is now: *${mode.toUpperCase()}*` });
    },
  },
];
