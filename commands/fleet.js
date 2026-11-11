// Sirf bot owner (developer) ke liye:
//   .botstatus  (ya .bot status)  — har server ka haal, total users aur per-server users
//   .botusers [server]  (ya .bot users) — un sab users ke number, kab se connect hain, aakhri activity
const fleet = require('../lib/fleet');

const OWNER_ONLY = '❌ Ye command sirf bot owner ke liye hai.';

async function showStatus(ctx) {
  const data = await fleet.servers();
  return ctx.reply(fleet.statusText(data));
}

async function showUsers(ctx, serverArg) {
  const sid = /^\d{1,2}$/.test(serverArg || '') ? String(Number(serverArg)) : null;
  const list = await fleet.users();
  const chunks = fleet.usersChunks(list, sid);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    // signature sirf aakhri hisse par
    await ctx.sock.sendMessage(ctx.from, last ? { text: chunks[i] } : { text: chunks[i], __noSign: true }, i === 0 ? { quoted: ctx.msg } : undefined);
  }
}

module.exports = [
  {
    name: 'botstatus',
    aliases: ['serverstatus', 'servers'],
    description: 'Har server ka status, total aur per-server users (sirf bot owner)',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isDeveloper) return ctx.reply(OWNER_ONLY);
      return showStatus(ctx);
    },
  },
  {
    name: 'botusers',
    aliases: ['allusers', 'userlist'],
    description: 'Bot use karne walon ke numbers aur connect hone ka waqt (sirf bot owner). .botusers 3 = sirf server 3',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isDeveloper) return ctx.reply(OWNER_ONLY);
      return showUsers(ctx, ctx.args?.[0]);
    },
  },
  {
    name: 'bot',
    aliases: [],
    description: '.bot status / .bot users (sirf bot owner)',
    category: 'owner',
    async execute(ctx) {
      if (!ctx.isDeveloper) return ctx.reply(OWNER_ONLY);
      const sub = String(ctx.args?.[0] || '').toLowerCase();
      if (sub === 'status') return showStatus(ctx);
      if (sub === 'users') return showUsers(ctx, ctx.args?.[1]);
      return ctx.reply(`ℹ️ Istemal: *${ctx.prefix}bot status* ya *${ctx.prefix}bot users*`);
    },
  },
];
