const axios = require('axios');

const commands = [
  {
    name: 'calc',
    aliases: ['calculate', 'math'],
    description: 'Calculate mathematical expressions',
    category: 'utility',
    async execute(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: *${ctx.prefix}calc 25 * 4 + 10*`);
      try {
        const sanitized = ctx.text.replace(/[^0-9+\-*/().^% ]/g, '');
        // Evaluate safe math
        const result = Function(`'use strict'; return (${sanitized})`)();
        await ctx.reply(`🧮 *Result:* ${result}`);
      } catch (err) {
        ctx.reply('❌ Invalid mathematical expression.');
      }
    }
  },
  {
    name: 'weather',
    aliases: ['forecast'],
    description: 'Get live weather for any city',
    category: 'utility',
    async execute(ctx) {
      const city = ctx.args[0] || 'Karachi';
      try {
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 8000 });
        const current = res.data?.current_condition?.[0];
        if (current) {
          const text = `🌤️ *Weather in ${city}*\n\n` +
            `• *Temperature:* ${current.temp_C}°C (${current.temp_F}°F)\n` +
            `• *Condition:* ${current.weatherDesc?.[0]?.value}\n` +
            `• *Humidity:* ${current.humidity}%\n` +
            `• *Wind Speed:* ${current.windspeedKmph} km/h`;
          await ctx.reply(text);
        } else {
          ctx.reply(`❌ Could not fetch weather for ${city}.`);
        }
      } catch (err) {
        ctx.reply('❌ Weather lookup failed: ' + err.message);
      }
    }
  },
  {
    name: 'translate',
    aliases: ['tr'],
    description: 'Translate text to English or specified language',
    category: 'utility',
    async execute(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: *${ctx.prefix}translate ur How are you?*`);
      const targetLang = ctx.args[0]?.length === 2 ? ctx.args[0] : 'en';
      const content = ctx.args[0]?.length === 2 ? ctx.args.slice(1).join(' ') : ctx.text;

      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(content)}`;
        const res = await axios.get(url, { timeout: 8000 });
        const translated = res.data?.[0]?.map(t => t[0]).join('');
        if (translated) {
          await ctx.reply(`🌐 *Translation [${targetLang.toUpperCase()}]:*\n${translated}`);
        } else {
          ctx.reply('❌ Translation failed.');
        }
      } catch (err) {
        ctx.reply('❌ Error translating: ' + err.message);
      }
    }
  },
  {
    name: 'qr',
    aliases: ['qrcode'],
    description: 'Generate a QR code image from text',
    category: 'utility',
    async execute(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: *${ctx.prefix}qr <text or URL>*`);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(ctx.text)}`;
      await ctx.sock.sendMessage(ctx.from, {
        image: { url: qrUrl },
        caption: `📱 *QR Code Generated*\nData: ${ctx.text}`
      }, { quoted: ctx.msg });
    }
  }
];

module.exports = commands;
