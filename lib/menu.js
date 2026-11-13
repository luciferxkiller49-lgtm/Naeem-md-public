const { SIGNATURE } = require('./signature');
// Bot ka menu: video + (Read more ke peeche chhupa hua) menu text + voice note
const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('./store');
const { getMainChannel, channelContext } = require('./channel');
const { sendCachedMedia } = require('./mediaCache');

const ASSETS = path.join(__dirname, '..', 'assets');
const VIDEO_PATH = path.join(ASSETS, 'menu-video.mp4');
const THUMB_PATH = path.join(ASSETS, 'menu-video-thumb.jpg');
const VOICE_PATH = path.join(ASSETS, 'menu-voice.ogg');
// Video / voice ki lambai (seconds) — file badlein to ye bhi badal dein
const VIDEO_SECONDS = 105;
const VOICE_SECONDS = 35;

const READ_MORE = '\u200e'.repeat(4001);

// Math-bold unicode: A-Z a-z 0-9
function mb(str) {
  return Array.from(String(str)).map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + (c - 65));
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + (c - 97));
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + (c - 48));
    return ch;
  }).join('');
}

const LABELS = { general: 'MAIN', downloader: 'DOWNLOAD', ownerself: 'OWNER', hack: 'HACK' };
const ORDER = ['MAIN', 'ISLAMIC', 'DOWNLOAD', 'GROUP', 'OWNER', 'MODERATION', 'SETTINGS', 'AI', 'UTILITY', 'FUN', 'MEDIA', 'MISC', 'HACK'];
const NO_SUFFIX = new Set(['MODERATION', 'UTILITY']); // in ke title ke aage "MENU" nahi likha jata

function buildMenuText({ commands, ownerName, mode, channelUrl }) {
  const cats = {};
  for (const c of commands) {
    const key = LABELS[c.category] || String(c.category || 'misc').toUpperCase();
    (cats[key] = cats[key] || []).push(c.name);
  }
  const keys = Object.keys(cats).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Ye hissa dikhta hai; iske baad "Read more"
  const head = [
    '╔══════════════════╗',
    '              بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ',
    '             اِیَّاکَ نَعۡبُدُ وَ اِیَّاکَ نَسۡتَعِیۡنُ',
    '╚══════════════════╝',
    '',
    `       ☠️ ${mb('NAEEM-MD')} ☠️`,
    '',
    `𖤍 ${mb('OWNER')} : ${mb(String(ownerName).toUpperCase())}`,
    `𖤍 ${mb('STATUS')} : ${mb('NO MERCY')}`,
    `𖤍 ${mb('MODE')} : ${mb(String(mode).toUpperCase())}`,
    `𖤍 ${mb('COMMANDS')} : ${mb(String(commands.length))}`,
  ].join('\n');

  const body = [
    '',
    '╔═════════════════╗',
    `     𖤐 ${mb('ENTER THE DARKNESS')}`,
    `              ➤ .${mb('menu')}`,
    '╚═════════════════╝',
    '',
  ];
  for (const k of keys) {
    const title = NO_SUFFIX.has(k) ? mb(k) : `${mb(k)} ${mb('MENU')}`;
    body.push(`╭━━━〔 ${title} 〕━━━`);
    for (const name of cats[k]) body.push(`┃ 𖤍 .${mb(name)}`);
    body.push('╰━━━━━━━━━━━━');
    if (k === 'HACK') body.push(`       ${mb('HACK MENU')} — ${mb('PRANK ONLY')}`);
    body.push('');
  }
  // Channel ka link ab menu text mein nahi (channel ka "forwarded" tag sendMenu mein lagta hai), footer wahi "POWERED BY" signature hai
  body.push(SIGNATURE);

  return { head, body: body.join('\n'), full: `${head}\n${READ_MORE}\n${body.join('\n')}` };
}

async function sendMenu(ctx) {
  const { sock, from, msg, botNumber } = ctx;
  const registry = require('./loadCommands');
  const s = await store.getInstanceSettings(botNumber);
  const t = buildMenuText({
    commands: registry.getAll(),
    ownerName: s.ownerName || config.OWNER_NAME,
    mode: s.mode || 'private',
  });
  const contextInfo = await channelContext(sock);
  const plainText = (text) => sock.sendMessage(from, { text, __noSign: true }, { quoted: msg });

  if (fs.existsSync(VIDEO_PATH)) {
    const payload = { video: { url: VIDEO_PATH }, mimetype: 'video/mp4', seconds: VIDEO_SECONDS };
    if (fs.existsSync(THUMB_PATH)) payload.jpegThumbnail = fs.readFileSync(THUMB_PATH);
    try {
      await sendCachedMedia(sock, from, 'video', 'menu-video', payload, { caption: t.full, contextInfo, quoted: msg });
    } catch (err) {
      console.error('[MENU] video+caption failed, sending split:', err.message);
      try {
        await sendCachedMedia(sock, from, 'video', 'menu-video', payload, { caption: t.head, contextInfo, quoted: msg });
        await plainText(t.body);
      } catch (e2) {
        await plainText(t.full);
      }
    }
  } else {
    await plainText(t.full);
  }

  if (fs.existsSync(VOICE_PATH)) {
    try {
      await sendCachedMedia(sock, from, 'audio', 'menu-voice',
        { audio: { url: VOICE_PATH }, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: VOICE_SECONDS }, {});
    } catch (err) {
      console.error('[MENU] voice failed:', err.message);
    }
  }
}

module.exports = { sendMenu, buildMenuText, mb };
