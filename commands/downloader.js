const axios = require('axios');
const { Readable } = require('node:stream');
const { createLimiter } = require('../lib/limiter');

// Downloads par load control: ek waqt mein sirf DL_CONCURRENCY (default 2) download, aur har download par time limit
// (DL_TIMEOUT_MS, default 120s). 50 users ek saath .song/.video lagayen to dyno ki RAM khatam nahi hogi.
const dlLimit = createLimiter(parseInt(process.env.DL_CONCURRENCY || '2', 10));
const DL_TIMEOUT_MS = Math.max(20000, parseInt(process.env.DL_TIMEOUT_MS || '120000', 10));
function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label || 'Kaam'} mein ${Math.round(ms / 1000)}s se zyada lag gaye, dobara koshish karein.`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

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
  if (!ytClientPromise) {
    // FIX: Heroku jaise datacenter IPs YouTube ko "bot jaisa" lagte hain, is
    // liye wo zyada tar videos par "sign in to confirm you're not a bot"
    // dikha deta hai — ye video-specific nahi, IP-specific restriction hai,
    // koi bhi client-type (ANDROID/TV/WEB) isay akela theek nahi karta.
    // Agar Config Var YOUTUBE_COOKIE set hai (kisi real, logged-in account
    // se), to wo request ko "asli insaan" jaisa bana deti hai aur ye
    // restriction zyada tar hat jati hai.
    const cookie = process.env.YOUTUBE_COOKIE || undefined;
    ytClientPromise = Innertube.create(cookie ? { cookie } : {});
  }
  return ytClientPromise;
}

async function resolveVideoId(query) {
  const urlMatch = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([A-Za-z0-9_-]{11})/.exec(query);
  if (urlMatch) return { id: urlMatch[1] };

  const yt = await getYtClient();
  const search = await withTimeout(yt.search(query, { type: 'video' }), 25000, 'YouTube search');
  // Sirf wo result jiska sahi video ID ho (channel cards / adhoore results chhod do)
  const list = [...(search?.videos || []), ...(search?.results || [])];
  const first = list.find((r) => r && typeof r.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(r.id));
  if (!first) return null;
  return { id: first.id, title: first.title?.text || first.title };
}

// FIX: sirf "ANDROID" bhi kaafi nahi nikla — kuch videos (khas kar jo
// YouTube "sign-in to confirm" list mein daal deta hai) har aam client par
// "login required" dete hain. "TV_EMBEDDED" khaas isi tarah ke videos ke
// liye bana hai (bina login ke age/region-restricted bhi chal jata hai).
// Teeno try karte hain, jo pehle chale wahi istemal hota hai.
const CLIENT_CHAIN = ['ANDROID', 'TV_EMBEDDED', 'IOS', 'MWEB', 'WEB']; // IOS / MWEB extra fallback (koi client na chale to agla)

async function getInfoWithFallback(yt, videoId) {
  let lastErr;
  for (const client of CLIENT_CHAIN) {
    try {
      return await (client === 'WEB' ? yt.getInfo(videoId) : yt.getInfo(videoId, client));
    } catch (err) {
      console.warn(`[YT] ${client} client failed for ${videoId}:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

async function downloadAudio(videoId) {
  const yt = await getYtClient();
  const info = await getInfoWithFallback(yt, videoId);
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
  const info = await getInfoWithFallback(yt, videoId);
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

// Login / bot-check error par saaf hint: cookie lagi ho to batayein ke wo expire / ghalat hai, warna cookie lagane ka kaha
function youtubeHint(msg) {
  if (!/login|not a bot|sign in/i.test(String(msg || ''))) return '';
  if (process.env.YOUTUBE_COOKIE) {
    return '\n\n_YOUTUBE_COOKIE lagi hai lekin YouTube ab bhi login maang raha hai. Cookie expire ya ghalat ho sakti hai: logged-in browser se nayi cookie copy karke Config Var mein dalein._';
  }
  return '\n\n_Server ka IP YouTube ko bot jaisa lag raha hai. Owner: YOUTUBE_COOKIE Config Var mein logged-in account ki cookie dalein._';
}

const NO_KEY_MSG = '❌ FastSaver key nahi mili. Heroku Config Vars mein FASTSAVER_API_KEY naam se key lagayein (naam bilkul yehi ho), phir Restart all dynos karein.';

// .song: pehle FastSaverAPI (YouTube ka server IP block nahi hota). Fail ho to purana youtubei tareeqa.
const fastsaver = require('../lib/fastsaver');
async function downloadAudioSmart(videoId, titleHint) {
  if (!videoId) throw new Error('Koi video nahi mila, doosra naam ya link try karein.');
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  if (!fastsaver.hasKeys()) {
    if (!process.env.YOUTUBE_COOKIE) throw new Error(NO_KEY_MSG);
    const r = await downloadAudio(videoId);
    return { buffer: r.buffer, url: null, title: r.title, durationSec: r.durationSec };
  }
  try {
    const link = await fastsaver.fetchAudioLink(ytUrl);
    let buffer = null;
    try { buffer = await fastsaver.downloadAudioBuffer(link); }
    catch (e) { console.warn('[SONG] audio file download fail, link se bhejenge:', e.message); }
    return { buffer, url: link, title: titleHint, durationSec: 0 };
  } catch (fsErr) {
    console.error('[SONG] FastSaver fail:', fsErr.message);
    try {
      const r = await downloadAudio(videoId);
      return { buffer: r.buffer, url: null, title: r.title, durationSec: r.durationSec };
    } catch (ytErr) {
      throw new Error(`FastSaver: ${fsErr.message} | YouTube: ${ytErr.message}`);
    }
  }
}

const NOT_READY_MSG = '❌ Is feature ke liye "youtubei.js" package abhi deploy nahi hui. package.json update karke dobara deploy karein.';
const MAX_DURATION_SEC = 15 * 60; // 15 minute — Heroku/WhatsApp par bohot lambi file bhejna mushkil hota hai

// ---- FastSaver se audio/video (sab commands isi ko use karte hain) ----
async function downloadMediaSmart(videoId, titleHint, format) {
  if (!videoId) throw new Error('Koi video nahi mila, doosra naam ya link try karein.');
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fallback = format === 'video' ? downloadVideo : downloadAudio;
  const maxBytes = format === 'video' ? fastsaver.MAX_VIDEO_BYTES : fastsaver.MAX_AUDIO_BYTES;
  if (!fastsaver.hasKeys()) {
    if (!process.env.YOUTUBE_COOKIE) throw new Error(NO_KEY_MSG);
    const r = await fallback(videoId);
    return { buffer: r.buffer, url: null, title: r.title, durationSec: r.durationSec };
  }
  try {
    // FastSaver video ke liye quality format chahta hai (audio, 144p ... 2160p). Default 480p, FASTSAVER_VIDEO_QUALITY se badal sakte hain.
    const apiFormat = format === 'video' ? (process.env.FASTSAVER_VIDEO_QUALITY || '480p') : 'audio';
    const link = await fastsaver.fetchMediaLink(ytUrl, apiFormat);
    let buffer = null;
    try { buffer = await fastsaver.downloadMediaBuffer(link, maxBytes); }
    catch (e) { console.warn(`[${format.toUpperCase()}] file download fail, link se bhejenge:`, e.message); }
    return { buffer, url: link, title: titleHint, durationSec: 0 };
  } catch (fsErr) {
    console.error(`[${format.toUpperCase()}] FastSaver fail:`, fsErr.message);
    try {
      const r = await fallback(videoId);
      return { buffer: r.buffer, url: null, title: r.title, durationSec: r.durationSec };
    } catch (ytErr) {
      throw new Error(`FastSaver: ${fsErr.message} | YouTube: ${ytErr.message}`);
    }
  }
}

// .play / .naat: .song jaisa hi (naat ke liye naam ke peeche "naat" lagta hai, link ho to nahi)
async function songLike(ctx, suffix) {
  const text = ctx.text || '';
  const isLink = /youtu/i.test(text);
  const query = text && suffix && !isLink ? text + suffix : text;
  const ytmp3 = commands.find((c) => c.name === 'ytmp3');
  return ytmp3.execute({ ...ctx, text: query });
}

async function videoCmd(ctx) {
  if (!ctx.text) return ctx.reply(`Usage: *${ctx.prefix}video <naam ya YouTube link>*`);
  if (!Innertube) return ctx.reply(NOT_READY_MSG);
  await ctx.react('🎬');
  try {
    const found = await resolveVideoId(ctx.text);
    if (!found) return ctx.reply('❌ Koi result nahi mila, doosra naam ya link try karein.');
    const got = await dlLimit(() => withTimeout(downloadMediaSmart(found.id, found.title, 'video'), DL_TIMEOUT_MS, 'Video download'));
    const media = got.buffer ? { video: got.buffer } : { video: { url: got.url } };
    await ctx.sock.sendMessage(ctx.from, {
      ...media,
      mimetype: 'video/mp4',
      caption: (got.title || found.title || '').slice(0, 200),
    }, { quoted: ctx.msg });
    await ctx.react('✅');
  } catch (err) {
    console.error('[VIDEO] error:', err.message);
    await ctx.reply(`❌ Video download nahi ho saka: ${err.message}`);
  }
}

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

        const got = await dlLimit(() => withTimeout(downloadAudioSmart(found.id, found.title), DL_TIMEOUT_MS, 'Audio download'));
        if (got.durationSec > MAX_DURATION_SEC) {
          return ctx.reply(`❌ *${got.title}* 15 minute se lamba hai, chhota gaana try karein.`);
        }

        const media = got.buffer ? { audio: got.buffer } : { audio: { url: got.url } };
        await ctx.sock.sendMessage(ctx.from, {
          ...media,
          mimetype: 'audio/mp4',
          fileName: `${(got.title || found.title || 'audio').slice(0, 60)}.m4a`,
        }, { quoted: ctx.msg });
        await ctx.react('✅');
      } catch (err) {
        console.error('[YTMP3] error:', err.message);
        const found2 = await resolveVideoId(ctx.text).catch(() => null);
        const vidInfo = found2 ? ` (video: ${found2.title || found2.id} — https://youtu.be/${found2.id})` : '';
        const hint = youtubeHint(err.message);
        await ctx.reply(`❌ Audio download nahi ho saka: ${err.message}${vidInfo}${hint}`);
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

        const { buffer, title, durationSec } = await dlLimit(() => withTimeout(downloadVideo(found.id), DL_TIMEOUT_MS, 'Video download'));
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
        const found2 = await resolveVideoId(ctx.text).catch(() => null);
        const vidInfo = found2 ? ` (video: ${found2.title || found2.id} — https://youtu.be/${found2.id})` : '';
        const hint = youtubeHint(err.message);
        await ctx.reply(`❌ Video download nahi ho saka: ${err.message}${vidInfo}${hint}`);
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
  },
  {
    name: 'play',
    aliases: [],
    description: 'Gaana naam se dhoond kar audio bhejta hai (.song jaisa)',
    category: 'downloader',
    async execute(ctx) { return songLike(ctx, ''); },
  },
  {
    name: 'naat',
    aliases: [],
    description: 'Naat dhoond kar audio bhejta hai',
    category: 'downloader',
    async execute(ctx) { return songLike(ctx, ' naat'); },
  },
  {
    name: 'video',
    aliases: ['ytvideo'],
    description: 'YouTube video naam ya link se bhejta hai (FastSaver)',
    category: 'downloader',
    async execute(ctx) { return videoCmd(ctx); },
  },
];

module.exports = commands;
