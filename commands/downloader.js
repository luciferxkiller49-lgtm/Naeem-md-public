const axios = require('axios');
const { Readable } = require('node:stream');

// YouTube download ke liye "youtubei.js" use karte hain (search + download
// dono isi mein built-in hain). Pehle "@distube/ytdl-core" istemal karne ka
// socha tha, lekin uske apne docs mein likha hai ke ab wo maintain nahi ho
// raha aur "youtubei.js" istemal karne ki salah di gayi hai — is liye
// shuru se hi mazboot wala choose kiya.
let Innertube = null;
try {
  ({ Innertube } = require('youtubei.js'));
} catch (e) {
  // package.json update hone ke baad deploy nahi hui — neeche is ki wajah se
  // saaf error milega, crash nahi hoga.
}

let ytClientPromise = null;
function getYtClient() {
  if (!Innertube) return null;
  if (!ytClientPromise) ytClientPromise = Innertube.create();
  return ytClientPromise;
}

async function resolveVideoId(query) {
  const urlMatch = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([A-Za-z0-9_-]{11})/.exec(query);
  if (urlMatch) return { id: urlMatch[1] };

  const yt = await getYtClient();
  const search = await yt.search(query, { type: 'video' });
  const first = (search?.videos && search.videos[0]) || (search?.results || []).find((r) => r?.id);
  if (!first) return null;
  return { id: first.id, title: first.title?.text || first.title };
}

async function downloadAudio(videoId) {
  const yt = await getYtClient();
  const info = await yt.getInfo(videoId);
  const stream = await info.download({ type: 'audio', quality: 'best' });
  const nodeStream = Readable.fromWeb(stream);
  const chunks = [];
  for await (const chunk of nodeStream) chunks.push(chunk);
  return {
    buffer: Buffer.concat(chunks),
    title: info.basic_info?.title || 'audio',
    durationSec: Number(info.basic_info?.duration || 0),
  };
}

async function downloadVideo(videoId) {
  const yt = await getYtClient();
  const info = await yt.getInfo(videoId);
  const stream = await info.download({ type: 'video+audio', quality: 'bestefficiency' });
  const nodeStream = Readable.fromWeb(stream);
  const chunks = [];
  for await (const chunk of nodeStream) chunks.push(chunk);
  return {
    buffer: Buffer.concat(chunks),
    title: info.basic_info?.title || 'video',
    durationSec: Number(info.basic_info?.duration || 0),
  };
}

const NOT_READY_MSG = '❌ Is feature ke liye "youtubei.js" package abhi deploy nahi hui. package.json update karke dobara deploy karein.';
const MAX_DURATION_SEC = 15 * 60; // 15 minute — Heroku/WhatsApp par bohot lambi file bhejna mushkil hota hai

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
    description: 'Download audio from YouTube (link ya naam se search)',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Usage: *${ctx.prefix}song <naam ya YouTube link>*`);
      }
      if (!Innertube) return ctx.reply(NOT_READY_MSG);

      await ctx.react('🎵');
      try {
        const found = await resolveVideoId(ctx.text);
        if (!found) return ctx.reply('❌ Koi result nahi mila, doosra naam ya link try karein.');

        const { buffer, title, durationSec } = await downloadAudio(found.id);
        if (durationSec > MAX_DURATION_SEC) {
          return ctx.reply(`❌ *${title}* 15 minute se lamba hai, chhota gaana try karein.`);
        }

        await ctx.sock.sendMessage(ctx.from, {
          audio: buffer,
          mimetype: 'audio/mp4',
          fileName: `${(title || 'audio').slice(0, 60)}.m4a`,
        }, { quoted: ctx.msg });
        await ctx.react('✅');
      } catch (err) {
        console.error('[YTMP3] error:', err.message);
        await ctx.reply('❌ Audio download nahi ho saka: ' + err.message);
      }
    }
  },
  {
    name: 'ytmp4',
    aliases: ['ytv', 'video'],
    description: 'Download video from YouTube (link ya naam se search)',
    category: 'downloader',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Usage: *${ctx.prefix}video <naam ya YouTube link>*`);
      }
      if (!Innertube) return ctx.reply(NOT_READY_MSG);

      await ctx.react('🎬');
      try {
        const found = await resolveVideoId(ctx.text);
        if (!found) return ctx.reply('❌ Koi result nahi mila, doosra naam ya link try karein.');

        const { buffer, title, durationSec } = await downloadVideo(found.id);
        if (durationSec > MAX_DURATION_SEC) {
          return ctx.reply(`❌ *${title}* 15 minute se lamba hai, chhoti video try karein.`);
        }

        await ctx.sock.sendMessage(ctx.from, {
          video: buffer,
          caption: `🎬 *${title || 'YouTube Video'}*`,
        }, { quoted: ctx.msg });
        await ctx.react('✅');
      } catch (err) {
        console.error('[YTMP4] error:', err.message);
        await ctx.reply('❌ Video download nahi ho saka: ' + err.message);
      }
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
      // NOTE: Ye abhi bhi placeholder hai — asal download implement nahi hua.
      // Agar isay bhi chalana hai to bata dein, isay bhi ytmp3 jaisa theek kar denge.
    }
  }
];

module.exports = commands;
