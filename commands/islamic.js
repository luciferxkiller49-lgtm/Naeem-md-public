const axios = require('axios');

const commands = [
  {
    name: 'surah',
    aliases: ['quran', 'ayah'],
    description: 'Fetch Quranic Surah or Ayah info',
    category: 'islamic',
    async execute(ctx) {
      const query = ctx.args[0] || '1';
      try {
        const res = await axios.get(`https://api.alquran.cloud/v1/surah/${query}/en.asad`, { timeout: 8000 });
        const data = res.data?.data;
        if (data) {
          let text = `📖 *Surah ${data.englishName} (${data.name})*\n` +
            `• *Type:* ${data.revelationType}\n` +
            `• *Ayahs:* ${data.numberOfAyahs}\n\n`;

          data.ayahs.slice(0, 5).forEach(a => {
            text += `[${a.numberInSurah}] ${a.text}\n`;
          });
          if (data.ayahs.length > 5) {
            text += `\n_...and ${data.ayahs.length - 5} more ayahs._`;
          }
          await ctx.reply(text);
        } else {
          ctx.reply('❌ Surah not found. Please provide a number between 1 and 114.');
        }
      } catch (err) {
        ctx.reply('❌ Error fetching Quranic data: ' + err.message);
      }
    }
  },
  {
    name: 'prayer',
    aliases: ['namaz', 'salat'],
    description: 'Get daily Islamic prayer times for a city',
    category: 'islamic',
    async execute(ctx) {
      const city = ctx.args[0] || 'Lahore';
      try {
        const res = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Pakistan&method=1`, { timeout: 8000 });
        const timings = res.data?.data?.timings;
        if (timings) {
          const text = `🕌 *Prayer Times for ${city}*\n\n` +
            `• Fajr: ${timings.Fajr}\n` +
            `• Dhuhr: ${timings.Dhuhr}\n` +
            `• Asr: ${timings.Asr}\n` +
            `• Maghrib: ${timings.Maghrib}\n` +
            `• Isha: ${timings.Isha}\n\n` +
            `_Date: ${res.data?.data?.date?.readable}_`;
          await ctx.reply(text);
        } else {
          ctx.reply(`❌ Could not fetch prayer times for ${city}.`);
        }
      } catch (err) {
        ctx.reply('❌ Error fetching prayer times: ' + err.message);
      }
    }
  }
];

module.exports = commands;
