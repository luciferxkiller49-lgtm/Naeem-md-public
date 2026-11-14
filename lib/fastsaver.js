// FastSaverAPI (api.fastsaver.io) se YouTube ka audio ya video link lena.
// Doc ke mutabiq: POST /v1/youtube/download, header X-Api-Key, body { url, format: "audio" | "video" }.
// Jawab mein download ka link aata hai. Field ka naam FastSaver ke jawab se pata chalta hai,
// is liye link ko jawab ke andar dhoondhte hain (YouTube ka apna link chhod kar).
// Free plan: 10 requests/minute. Rate limit ka faisla bot ki taraf se hota hai taake key bekaar na jale.
const axios = require('axios');
const apiPool = require('./apiPool');

const ENDPOINT = process.env.FASTSAVER_ENDPOINT || 'https://api.fastsaver.io/v1/youtube/download';
const NAME = 'FASTSAVER';
const TIMEOUT_MS = 60000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const RATE_PER_MIN = 10;
const stamps = [];

function rateOk() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= RATE_PER_MIN) return false;
  stamps.push(now);
  return true;
}

function hasKeys() { return apiPool.loadKeys(NAME).length > 0; }

// Jawab ke andar sab string URLs dhoondhta hai, YouTube wale chhod kar. Format ke hisaab se naam ko score deta hai.
function findMediaUrl(data, ytUrl, format = 'audio') {
  const urls = [];
  const walk = (node, key, depth) => {
    if (node == null || depth > 6) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node) && node !== ytUrl && !/youtube\.com|youtu\.be/i.test(node)) urls.push({ key, url: node });
      return;
    }
    if (Array.isArray(node)) { node.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1);
  };
  walk(data, '', 0);
  const score = (k) => (new RegExp(format, 'i').test(k) ? 3 : 0) + (/download|link|url/i.test(k) ? 2 : 0);
  urls.sort((a, b) => score(b.key) - score(a.key));
  return urls[0]?.url || null;
}

async function requestMedia(ytUrl, key, format) {
  const res = await axios.post(ENDPOINT, { url: ytUrl, format }, {
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  });
  const d = res.data && typeof res.data === 'object' ? res.data : {};
  if (res.status < 200 || res.status >= 300) {
    const m = d?.error?.message || d?.message || (typeof d?.error === 'string' ? d.error : '') || `HTTP ${res.status}`;
    throw new Error(`FastSaver ${res.status}: ${String(m).slice(0, 160)}`);
  }
  const link = findMediaUrl(d, ytUrl, format);
  if (!link) throw new Error(`FastSaver jawab mein ${format} link nahi mila (fields: ${Object.keys(d).join(',') || 'none'})`);
  return link;
}

async function fetchMediaLink(ytUrl, format = 'audio') {
  if (!hasKeys()) throw new Error('FASTSAVER_API_KEY Config Var set nahi hai (Heroku mein FASTSAVER_API_KEY lagayein).');
  if (!rateOk()) throw new Error('FastSaver ki rate limit (10 requests/minute) poori ho gayi, 1 minute baad try karein.');
  return apiPool.call((key) => requestMedia(ytUrl, key, format), { label: `youtube-${format}`, name: NAME });
}

const fetchAudioLink = (ytUrl) => fetchMediaLink(ytUrl, 'audio');
const requestAudio = (ytUrl, key) => requestMedia(ytUrl, key, 'audio');

async function downloadMediaBuffer(link, maxBytes = MAX_AUDIO_BYTES) {
  const r = await axios.get(link, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_MS,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
  });
  return Buffer.from(r.data);
}
const downloadAudioBuffer = (link) => downloadMediaBuffer(link, MAX_AUDIO_BYTES);

module.exports = {
  fetchAudioLink, fetchMediaLink, downloadAudioBuffer, downloadMediaBuffer,
  findAudioUrl: findMediaUrl, findMediaUrl, requestAudio, requestMedia, hasKeys,
  MAX_AUDIO_BYTES, MAX_VIDEO_BYTES,
};

// Deploy/restart par ek line: kitni FastSaver keys app ko mili (key ka text nahi dikhta)
try {
  const n = apiPool.loadKeys(NAME).length;
  console.log(`[FASTSAVER] API keys loaded: ${n}${n ? '' : ' — FASTSAVER_API_KEY Config Var check karein'}`);
} catch (e) { /* log ki wajah se startup na ruke */ }
