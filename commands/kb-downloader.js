const axios = require('axios');

// Har request par time limit (pehle koi timeout nahi tha, request atki reh sakti thi) aur page ka size limit
const HTTP_TIMEOUT = 20000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 60 * 1024 * 1024; // mediafire: isse badi file nahi bhejte (dyno ki memory/disk)

// URL ka host asli domain ho (sirf "kahin text mein facebook.com likha ho" kaafi nahi — warna koi bhi URL fetch ho jata)
function hostIs(url, domains) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return domains.some((d) => h === d || h.endsWith(`.${d}`));
  } catch (e) { return false; }
}
const isPinterest = (url) => {
  try { const h = new URL(url).hostname.toLowerCase(); return /(^|\.)pinterest\.[a-z.]+$/.test(h) || h === 'pin.it' || h.endsWith('.pin.it'); }
  catch (e) { return false; }
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// tikwm.com ek free, no-API-key wali public service hai jo TikTok videos
// bina watermark ke deti hai — widely used, koi key ki zaroorat nahi
async function tikwmFetch(url) {
  const { data } = await axios.get('https://tikwm.com/api/', {
    params: { url },
    headers: { 'User-Agent': BROWSER_UA },
    timeout: HTTP_TIMEOUT,
  });
  if (!data || data.code !== 0 || !data.data) {
    throw new Error(data?.msg || 'tikwm fetch failed');
  }
  return data.data;
}

// Mediafire page ka HTML fetch karke direct download link nikaalta hai (no API key)
async function resolveMediafireUrl(url) {
  const { data: html } = await axios.get(url, { headers: { 'User-Agent': BROWSER_UA }, timeout: HTTP_TIMEOUT, maxContentLength: MAX_HTML_BYTES, responseType: 'text' });
  const match = html.match(/href="(https:\/\/download[^"]+)"/);
  return match?.[1] || null;
}

// Pinterest pin page (ya pin.it short link) se og:video/og:image nikaalta hai (no API key)
async function resolvePinterestUrl(url) {
  const { data: html } = await axios.get(url, { headers: { 'User-Agent': BROWSER_UA }, timeout: HTTP_TIMEOUT, maxContentLength: MAX_HTML_BYTES, responseType: 'text' });
  const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/);
  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  return { video: videoMatch?.[1] || null, image: imageMatch?.[1] || null };
}

// Facebook video page (mbasic version) se hd/sd source nikaalta hai (no API key).
// Note: Facebook apna HTML frequently badalta rehta hai, isliye ye kabhi kabhi
// fail ho sakta hai — koi bhi free scrape-based method 100% reliable nahi hoti.
async function resolveFacebookUrl(url) {
  const mobileUrl = url.replace(/(www|m)\.facebook\.com/, 'mbasic.facebook.com');
  const { data: html } = await axios.get(mobileUrl, { headers: { 'User-Agent': BROWSER_UA }, timeout: HTTP_TIMEOUT, maxContentLength: MAX_HTML_BYTES, responseType: 'text' });
  const hd = html.match(/hd_src:"([^"]+)"/) || html.match(/"browser_native_hd_url":"([^"]+)"/);
  const sd = html.match(/sd_src:"([^"]+)"/) || html.match(/"browser_native_sd_url":"([^"]+)"/);
  const raw = hd?.[1] || sd?.[1];
  return raw ? raw.replace(/\\\//g, '/') : null;
}

module.exports = [
  {
    name: 'ttmp3',
    aliases: ['tomp3'],
    description: 'TikTok video ka background music/audio nikaalta hai — free public API',
    execute: async ({ sock, from, args }) => {
      const url = args[0];
      if (!url || !hostIs(url, ['tiktok.com'])) return sock.sendMessage(from, { text: 'Provide a TikTok link. e.g. .ttmp3 https://vm.tiktok.com/xxxx' });
      await sock.sendMessage(from, { text: '⏳ Extracting audio...' });
      try {
        const result = await tikwmFetch(url);
        if (!result.music) throw new Error('No audio URL in response');
        await sock.sendMessage(from, { audio: { url: result.music }, mimetype: 'audio/mp4' });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Could not extract audio.' });
      }
    },
  },
  {
    name: 'pinterest',
    aliases: ['pin'],
    description: 'Pinterest pin se image/video download karta hai — free (no API key)',
    execute: async ({ sock, from, args }) => {
      const url = args[0];
      if (!url || !isPinterest(url)) {
        return sock.sendMessage(from, { text: 'Provide a Pinterest link. e.g. .pinterest https://pin.it/xxxx' });
      }
      await sock.sendMessage(from, { text: '⏳ Downloading...' });
      try {
        const { video, image } = await resolvePinterestUrl(url);
        if (video) await sock.sendMessage(from, { video: { url: video }, caption: '✅ Pinterest video' });
        else if (image) await sock.sendMessage(from, { image: { url: image }, caption: '✅ Pinterest image' });
        else throw new Error('No media found on page');
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Download failed. Please check the link.' });
      }
    },
  },
  {
    name: 'mediafire',
    description: 'Mediafire link se file download karta hai — free (no API key)',
    execute: async ({ sock, from, args }) => {
      const url = args[0];
      if (!url || !hostIs(url, ['mediafire.com'])) {
        return sock.sendMessage(from, { text: 'Provide a Mediafire link. e.g. .mediafire https://www.mediafire.com/file/xxxx' });
      }
      await sock.sendMessage(from, { text: '⏳ Fetching file...' });
      try {
        const directUrl = await resolveMediafireUrl(url);
        if (!directUrl) throw new Error('No direct link found on page');
        // Bohot badi file na bhejein (dyno ki memory/disk ka khayal)
        try {
          const head = await axios.head(directUrl, { timeout: 15000, headers: { 'User-Agent': BROWSER_UA } });
          const size = parseInt(head.headers['content-length'] || '0', 10);
          if (size > MAX_FILE_BYTES) {
            return sock.sendMessage(from, { text: `❌ File bohot badi hai (${Math.round(size / 1048576)}MB). Maximum ${Math.round(MAX_FILE_BYTES / 1048576)}MB tak bhej sakta hoon.` });
          }
        } catch (e) { /* size na mile to bhi koshish karte hain */ }
        await sock.sendMessage(from, {
          document: { url: directUrl },
          fileName: directUrl.split('/').pop() || 'mediafire-file',
          mimetype: 'application/octet-stream',
          caption: '✅ Mediafire file',
        });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, {
          text: '❌ Could not fetch the file. Mediafire may have changed their page format, or the link expired.',
        });
      }
    },
  },
  {
    name: 'fb',
    aliases: ['facebook'],
    description: 'Facebook video download karta hai — free scrape-based (kabhi kabhi unreliable ho sakta hai)',
    execute: async ({ sock, from, args }) => {
      const url = args[0];
      if (!url || !hostIs(url, ['facebook.com', 'fb.watch', 'fb.com'])) {
        return sock.sendMessage(from, { text: 'Provide a Facebook video link. e.g. .fb https://facebook.com/xxxx/videos/xxxx' });
      }
      await sock.sendMessage(from, { text: '⏳ Downloading...' });
      try {
        const videoUrl = await resolveFacebookUrl(url);
        if (!videoUrl) throw new Error('No video URL found on page');
        await sock.sendMessage(from, { video: { url: videoUrl }, caption: '✅ Facebook video' });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, {
          text: '❌ Download failed. Facebook frequently changes its page format, which can break this — try again later or use a different link.',
        });
      }
    },
  },
];
