// commands/antigcstatus2.js
// Sirf TEST ke liye: .antigcstatus2 on/off — group-specific, RAM-only (restart par reset)
const { setOn, isOn } = require('../lib/antigcstatusFresh');

module.exports = [
  {
    name: 'antigcstatus2',
    aliases: ['gcstatus2test'],
    description: 'TEST: bilkul naya/fresh group-status detector (sirf is group mein, restart par reset hota hai)',
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
          text: `Usage: .antigcstatus2 on | off\n(Abhi is group mein: ${isOn(from) ? 'ON' : 'OFF'})\n\n⚠️ Ye sirf TEST command hai — Heroku logs mein [GCSTATUS2] dekh kar analyze karne ke liye.`,
        });
      }
      setOn(from, opt === 'on');
      return sock.sendMessage(from, { text: `✅ antigcstatus2 (TEST) ab ${opt.toUpperCase()} hai is group mein.` });
    },
  },
];
