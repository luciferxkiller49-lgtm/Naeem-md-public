// .gcdiag — group status (story) / antistatus ki jaanch: bot ne kya dekha aur kya kiya (sirf bot owner)
const store = require('../lib/store');
const gcTrace = require('../lib/gcTrace');
const { botIsAdmin } = require('../lib/groupUtil');

const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};
const tail = (j) => String(j || '?').split('@')[0].slice(-6);

module.exports = [
  {
    name: 'gcdiag',
    aliases: ['gcstatusdiag', 'antistatusdiag'],
    description: 'Group status / antistatus ki jaanch: bot ne kya dekha aur kya kiya (sirf bot owner)',
    category: 'group',
    async execute(ctx) {
      const { sock, from, args, prefix, isInstanceOwner, reply } = ctx;
      if (!isInstanceOwner) return reply('❌ This command is only for the bot owner.');
      const inGroup = from.endsWith('@g.us');
      const lines = ['🧪 *GCSTATUS / ANTISTATUS DIAG*', ''];

      if (inGroup) {
        const gs = await store.getGroupSettings(from);
        const flag = !gs.antigcstatus || gs.antigcstatus === 'off' ? 'OFF' : String(gs.antigcstatus).toUpperCase();
        let adminTxt = '?';
        try {
          const meta = await sock.groupMetadata(from);
          adminTxt = botIsAdmin(meta.participants || [], sock) ? 'haan ✅' : 'NAHI ❌ (delete nahi kar sakta)';
        } catch (e) { adminTxt = `maloomat nahi mili (${e.message})`; }
        lines.push(`• Antistatus (${prefix}antistatus): *${flag}*`, `• Bot is group mein admin: ${adminTxt}`, '');
      } else {
        lines.push(`💡 Kisi group ke andar ${prefix}gcdiag likhein to us group ka flag aur bot admin status bhi dikhega.`, '');
      }

      const list = gcTrace.last(8, inGroup ? from : undefined);
      if (!list.length) {
        lines.push('📭 Abhi tak is bot ne koi group status event nahi dekha.');
        lines.push('', 'Ab kisi *doosre member* se is group mein status lagwayen (khud admin na ho, warna antistatus chhod deta hai), phir dobara', `${prefix}gcdiag likhein.`);
        lines.push('Agar phir bhi khaali rahe to iska matlab hai ke WhatsApp ye status is bot (linked device) tak bhej hi nahi raha — us surat mein antistatus technically kaam nahi kar sakta.');
      } else {
        lines.push('🕘 *Aakhri events* (purana → naya):');
        for (const e of list) {
          const who = e.sender ? ` • ${tail(e.sender)}` : '';
          const where = e.group ? ` • grp …${tail(e.group)}` : '';
          const route = e.route ? ` • raasta: ${e.route}` : '';
          lines.push(`• ${ago(e.t)} pehle [${e.kind}]${route}${where}${who}\n   ↳ ${e.result}`);
        }
      }

      if ((args[0] || '').toLowerCase() === 'raw') {
        const withShape = [...gcTrace.last(60, inGroup ? from : undefined)].reverse().find((e) => e.shape);
        lines.push('', '🧱 *Aakhri status ka structure* (developer ko bhejne ke liye):', '```' + JSON.stringify(withShape?.shape || 'koi nahi', null, 1).slice(0, 1800) + '```');
      } else {
        lines.push('', `Poora structure dekhne ke liye: ${prefix}gcdiag raw`);
      }
      return reply(lines.join('\n'));
    },
  },
];
