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

      const replyText = ` Pong! ⚡\n` +
        `• *Speed:* ${latency}ms\n` +
        `• *Server:* Server ${config.APP_ID}\n` +
        `• *Platform:* ${os.platform()} (${os.arch()})`;

      // .menu ki tarah .ping ke sath bhi channel ka link-preview "forward"
      // ho kar aata hai.
      const { channelContext } = require('../lib/channel');
      const contextInfo = await channelContext(ctx.sock);
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
