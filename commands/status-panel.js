// .status — kaun sa feature ON hai aur kaun sa OFF
const store = require('../lib/store');
const { tinyBold } = require('../lib/font');
const { getUptimeText } = require('../lib/uptime');

const state = (v) => {
  if (!v || v === 'off') return { icon: '❌', text: 'OFF' };
  return { icon: '✅', text: v === true ? 'ON' : String(v).toUpperCase() };
};
const row = (label, v) => {
  const s = state(v);
  return `${s.icon} ${tinyBold(`${label} —`)} ${tinyBold(s.text)}`;
};

module.exports = [
  {
    name: 'status',
    aliases: ['features', 'settingsview'],
    description: 'Shows which features are ON or OFF',
    category: 'general',
    async execute(ctx) {
      const { sock, from, botNumber, isInstanceOwner, isGroup } = ctx;
      const lines = [tinyBold('⚙️ Feature Status'), ''];

      if (from.endsWith('@g.us')) {
        const gs = await store.getGroupSettings(from);
        let name = 'This group';
        try { name = (await sock.groupMetadata(from)).subject || name; } catch (e) {}
        lines.push(`${tinyBold('👥 Group:')} ${name}`, '');
        lines.push(
          row('Welcome', gs.welcomeOn),
          row('Goodbye', gs.goodbyeOn),
          row('Antilink', gs.antilink),
          row('Antivoice', gs.antivoice),
          row('Antisticker', gs.antisticker),
          row('Antivideo', gs.antivideo),
          row('Antipic', gs.antipic),
          row('Antigcstatus', gs.antigcstatus),
          row('Antimention', gs.antimention),
          row('Antiedit', gs.antieditOn),
        );
      }

      if (isInstanceOwner || !from.endsWith('@g.us')) {
        const s = await store.getInstanceSettings(botNumber);
        if (lines.length > 2) lines.push('');
        lines.push(tinyBold('🤖 Bot'), '');
        lines.push(
          row('Antidelete', s.antideleteOn),
          row('Antiedit (private chats)', s.antieditOn),
          row('Anticall', s.antiCall),
          row('Autoread', s.autoRead),
          row('Autoreact', s.autoReact),
          row('Autotyping', s.autoTyping),
          row('Statusview', s.statusView),
          row('Chatbot', s.chatbot),
          row('Away', s.awayEnabled),
          row('AFK', s.afk),
        );
        lines.push('', `${tinyBold('🌐 Mode:')} ${tinyBold(String(s.mode || 'public'))}`, `${tinyBold('⏱️ Uptime:')} ${getUptimeText()}`);
      }

      await sock.sendMessage(from, { text: lines.join('\n') });
    },
  },
];
