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
    description: 'Saare commands ki list dikhata hai',
    category: 'general',
    async execute(ctx) {
      const fs = require('fs');
      const registry = require('../lib/loadCommands');
      const store = require('../lib/store');
      const { getUptimeText } = require('../lib/uptime');
      const { channelContext, getMainChannel } = require('../lib/channel');

      const s = await store.getInstanceSettings(ctx.botNumber);
      const botName = s.botName || config.BOT_NAME;
      const ownerName = s.ownerName || config.OWNER_NAME;
      const p = ctx.prefix;
      const all = registry.getAll();

      const LABELS = {
        general: 'MAIN', downloader: 'DOWNLOAD', ownerself: 'OWNER', hack: 'HACK (prank only)',
      };
      const ORDER = ['MAIN', 'ISLAMIC', 'DOWNLOAD', 'GROUP', 'OWNER', 'MODERATION', 'SETTINGS', 'AI', 'UTILITY', 'FUN', 'MEDIA', 'MISC', 'HACK (prank only)'];
      const cats = {};
      for (const c of all) {
        const key = LABELS[c.category] || String(c.category || 'misc').toUpperCase();
        (cats[key] = cats[key] || []).push(c.name);
      }
      const keys = Object.keys(cats).sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let text = `بِسْمِ اللّٰہِ الرَّحْمٰنِ الرَّحِیمِ\nاِیَّاکَ نَعۡبُدُ وَ اِیَّاکَ نَسۡتَعِیۡنُ☝️\n\n`;
      text += `┌─── ❖\n│ 👑 Owner: ${ownerName}\n│ ⏱️ Uptime: ${getUptimeText()}\n`;
      text += `│ 📜 Commands: ${all.length}\n│ 🌐 Mode: ${s.mode}\n│ 🚀 Node: ${config.APP_ID}\n└───📌\n\n*${botName}*\n\n`;
      for (const k of keys) {
        text += `╭───〔 ${k} MENU 〕───\n│\n`;
        for (const n of cats[k]) text += `│ ⚡︎ ${p}${n}\n`;
        text += `╰───────────────────────\n\n`;
      }
      const ch = await getMainChannel(ctx.sock);
      if (ch?.url) text += `📢 Channel: ${ch.url}\n\n`;
      text += `> ✨ Powered by ${ownerName} ✨`;

      const contextInfo = await channelContext(ctx.sock);
      const base = fs.existsSync(config.menuImagePath)
        ? { image: fs.readFileSync(config.menuImagePath), caption: text }
        : { text };
      if (contextInfo) base.contextInfo = contextInfo;
      try {
        await ctx.sock.sendMessage(ctx.from, base, { quoted: ctx.msg });
      } catch (e) {
        await ctx.sock.sendMessage(ctx.from, { text });
      }

      try {
        if (fs.existsSync(config.menuVoicePath)) {
          await ctx.sock.sendMessage(ctx.from, { audio: fs.readFileSync(config.menuVoicePath), mimetype: 'audio/ogg; codecs=opus', ptt: true });
        }
      } catch (e) {}
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
