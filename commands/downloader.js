const axios = require('axios');

const commands = [
  {
    name: 'tiktok',
    aliases: ['tt', 'ttdl'],
    description: 'Download TikTok video without watermark',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text || !ctx.text.includes('tiktok.com')) {
        return ctx.reply(`Please provide a valid TikTok link.\nExample: *${ctx.prefix}tiktok https://vm.tiktok.com/xxxxxx*`);
      }

      await ctx.react('⏳');
      try {
        const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(ctx.text)}`;
        const res = await axios.get(apiUrl, { timeout: 12000 });
        const videoUrl = res.data?.video?.noWatermark || res.data?.video?.watermark;

        if (videoUrl) {
          await ctx.sock.sendMessage(ctx.from, {
            video: { url: videoUrl },
            caption: `🎥 *TikTok Video Downloaded*\nTitle: ${res.data.title || 'TikTok'}\nAuthor: ${res.data.author?.name || ''}`
          }, { quoted: ctx.msg });
          await ctx.react('✅');
        } else {
          ctx.reply('❌ Could not fetch video from provided TikTok link.');
        }
      } catch (err) {
        ctx.reply('❌ Failed to process TikTok link: ' + err.message);
      }
    }
  },
  {
    name: 'ytmp3',
    aliases: ['yta', 'song'],
    description: 'Download audio from YouTube URL',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Usage: *${ctx.prefix}ytmp3 <YouTube URL or Search Query>*`);
      }
      await ctx.react('🎵');
      await ctx.reply(`🔍 Searching & downloading audio for: *${ctx.text}*...\n_Please wait a moment._`);
    }
  },
  {
    name: 'ytmp4',
    aliases: ['ytv', 'video'],
    description: 'Download video from YouTube URL',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Usage: *${ctx.prefix}ytmp4 <YouTube URL>*`);
      }
      await ctx.react('🎬');
      await ctx.reply(`🔍 Fetching video stream for: *${ctx.text}*...\n_Processing HD quality._`);
    }
  },
  {
    name: 'instagram',
    aliases: ['ig', 'igdl'],
    description: 'Download Instagram reels or posts',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text || !ctx.text.includes('instagram.com')) {
        return ctx.reply(`Please provide an Instagram post or reel link.\nExample: *${ctx.prefix}ig https://instagram.com/reel/xxxx*`);
      }
      await ctx.react('📸');
      await ctx.reply(`⏳ Fetching Instagram media...`);
    }
  }
];

module.exports = commands;
