const os = require('os');
const config = require('../config');

const commands = [
  {
    name: 'ping',
    aliases: ['p', 'speed'],
    description: 'Check bot response latency and server status',
    category: 'general',
    async execute(ctx) {
      const start = Date.now();
      await ctx.react('⚡');
      const latency = Date.now() - start;
      const uptime = Math.floor(process.uptime());
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const replyText = ` Pong! ⚡\n` +
        `• *Speed:* ${latency}ms\n` +
        `• *Node ID:* Node ${config.APP_ID}\n` +
        `• *Uptime:* ${hours}h ${minutes}m ${seconds}s\n` +
        `• *Platform:* ${os.platform()} (${os.arch()})\n` +
        `• *Edition:* Extreme Edition`;

      await ctx.reply(replyText);
    }
  },
  {
    name: 'menu',
    aliases: ['help', 'commands', 'list'],
    description: 'Display all available bot commands by category',
    category: 'general',
    async execute(ctx) {
      const registry = require('../lib/loadCommands');
      const allCmds = registry.getAll();

      const categories = {};
      allCmds.forEach(cmd => {
        const cat = cmd.category || 'misc';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(cmd.name);
      });

      let menuText = `╭───『 *${config.BOT_NAME.toUpperCase()}* 』───\n` +
        `│ 👑 *Owner:* ${config.OWNER_NAME}\n` +
        `│ 🚀 *Node:* ${config.APP_ID} / 10\n` +
        `│ ⚡ *Commands:* ${allCmds.length}\n` +
        `│ 🔑 *Prefix:* ${ctx.prefix}\n` +
        `╰─────────────────────\n\n`;

      for (const cat in categories) {
        menuText += `╭───『 *${cat.toUpperCase()}* 』───\n`;
        categories[cat].forEach(name => {
          menuText += `│ • ${ctx.prefix}${name}\n`;
        });
        menuText += `╰─────────────────────\n\n`;
      }

      menuText += `_Type ${ctx.prefix}help <command> for detailed info._\n` +
        `_Powered by Naeemxlucifer Extreme Cluster_`;

      await ctx.reply(menuText);
    }
  },
  {
    name: 'alive',
    aliases: ['status', 'uptime'],
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
