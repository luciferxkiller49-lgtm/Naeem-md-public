const config = require('../config');
const { channelContext } = require('../lib/channel');

const commands = [
  {
    name: 'ping',
    aliases: ['p', 'speed'],
    description: 'Check bot response latency and server status',
    category: 'general',
    async execute(ctx) {
      const start = Date.now();
      try { await ctx.react('⚡'); } catch (e) { /* reaction na lage to bhi jawab zaroor jaye */ }
      const latency = Date.now() - start;

      const replyText = ` Pong! ⚡\n` +
        `• *Speed:* ${latency}ms\n` +
        `• *Server:* ${config.APP_ID}`;

      // Menu ki tarah channel ka "forwarded" tag. Lookup time-limited hai, isliye ye jawab ko rokta nahi.
      const contextInfo = await channelContext(ctx.sock).catch(() => undefined);
      await ctx.sock.sendMessage(ctx.from, { text: replyText, contextInfo }, { quoted: ctx.msg });
    }
  },
  {
    name: 'menu',
    aliases: ['help', 'commands', 'list'],
    description: 'Saare commands ki list dikhata hai',
    category: 'general',
    async execute(ctx) {
      await require('../lib/menu').sendMenu(ctx);
    }
  },
  {
    name: 'alive',
    aliases: ['uptime'],
    description: 'Display bot status and cluster connection health',
    category: 'general',
    async execute(ctx) {
      const text = `👑 *${config.BOT_NAME} IS ONLINE & RUNNING*\n\n` +
        `• *App Dyno:* Node #${config.APP_ID}\n` +
        `• *Mode:* ${config.MODE}\n` +
        `• *Version:* 2.0.0 Extreme Edition\n` +
        `• *Database:* MongoDB Atlas Active\n\n` +
        `_Feel free to explore features using ${ctx.prefix}menu_`;
      await ctx.reply(text);
    }
  },
  {
    name: 'owner',
    aliases: ['creator', 'developer'],
    description: 'Get bot creator contact info',
    category: 'general',
    async execute(ctx) {
      const vcard = 'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${config.OWNER_NAME}\n` +
        `ORG:${config.BOT_NAME};\n` +
        `TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\n` +
        'END:VCARD';

      await ctx.sock.sendMessage(ctx.from, {
        contacts: {
          displayName: config.OWNER_NAME,
          contacts: [{ vcard }]
        }
      }, { quoted: ctx.msg });
    }
  }
];

module.exports = commands;
