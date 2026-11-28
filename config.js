require('dotenv').config();

// FIX: the old code had `PANEL_KEY: process.env.PANEL_KEY || 'naeem_extreme_secret_2026'`
// — that fallback string lives in the GitHub repo in plain text. If any of the
// 10 Heroku apps ever had PANEL_KEY unset (typo, forgot to copy, new app not
// configured yet) it would silently fall back to this public value, and
// anyone reading the repo could hit /code on that app directly. Now the app
// refuses to start at all without a real PANEL_KEY.
const PANEL_KEY = process.env.PANEL_KEY || null;

if (!PANEL_KEY) {
  console.error('[CONFIG] FATAL: PANEL_KEY environment variable is not set.');
  console.error('[CONFIG] Set PANEL_KEY in Heroku Config Vars (same value on the panel + all 10 bot apps) and redeploy.');
  process.exit(1);
}

// APP_ID ab zaroori hai (1 se 10, har Heroku app ka alag). Pehle default '1' tha, is se jis app par APP_ID
// bhoolta wo node 1 ki sessions utha leta tha aur do dyno ek hi session par lad padte the (440 loop).
// Ab APP_ID na ho to app crash nahi hoti, lekin koi session load nahi karti aur pairing mein saaf error deti hai.
const APP_ID_RAW = String(process.env.APP_ID || '').trim();
const APP_ID_MISSING = !/^\d{1,2}$/.test(APP_ID_RAW);
if (APP_ID_MISSING) {
  console.error('[CONFIG] ERROR: APP_ID Config Var set nahi (ya galat hai). Is app par koi bot session load nahi hoga aur pairing band rahegi.');
  console.error('[CONFIG] Heroku Config Vars mein APP_ID=1..10 set karein (har app ka alag) aur restart karein.');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  APP_ID: APP_ID_MISSING ? '' : APP_ID_RAW, // 1 to 10, one per Heroku dyno
  APP_ID_MISSING,
  SERVER_NAME: process.env.SERVER_NAME || '', // optional: .ping mein dikhane ka naam (khali = 'Server #N')
  MONGODB_URI: process.env.MONGODB_URI || '',
  PANEL_KEY,

  // Bot Defaults
  BOT_NAME: process.env.BOT_NAME || 'Naeem-MD',
  OWNER_NAME: process.env.OWNER_NAME || 'Naeem',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '923000000000',
  DEFAULT_PREFIX: process.env.DEFAULT_PREFIX || '.',
  MAX_LIMIT: Number(process.env.MAX_LIMIT || 50), // 50 active numbers per app, per spec

  MODE: process.env.MODE || 'public',

  // Sticker defaults
  PACK_NAME: process.env.PACK_NAME || 'Naeem-MD',
  PACK_AUTHOR: process.env.PACK_AUTHOR || 'Extreme Edition',

  // Delays & Safety
  COMMAND_COOLDOWN_MS: 1500,
  GC_STATUS_DELAY_MS: 3000
};

// ---- Katabump-style aliases + channel/menu settings ----
const _path = require('path');
const _cfg = module.exports;
_cfg.prefix = _cfg.DEFAULT_PREFIX;
_cfg.botName = _cfg.BOT_NAME;
_cfg.ownerName = _cfg.OWNER_NAME;
_cfg.ownerNumber = _cfg.OWNER_NUMBER;
_cfg.openaiApiKey = process.env.OPENAI_API_KEY || '';
_cfg.menuImagePath = _path.join(__dirname, 'assets', 'menu-image.jpeg');
_cfg.menuVoicePath = _path.join(__dirname, 'assets', 'menu-voice.ogg');
// CHANNEL_INVITES env (comma separated) se override hota hai. Pehla link "main" channel hai (menu mein dikhta hai).
_cfg.channelInvites = (process.env.CHANNEL_INVITES || [
  'https://whatsapp.com/channel/0029VbDr7L0Chq6KglTFUk16',
  'https://whatsapp.com/channel/0029Vb8uBP0HFxOyA9xGXC2S',
  'https://whatsapp.com/channel/0029Vb8pZ9CHVvTi56wgy40Q',
  'https://whatsapp.com/channel/0029VbDtvePDp2Q45xfSpA0k',
  'https://whatsapp.com/channel/0029VbD5jb61nozCAHIIQE0J',
  'https://whatsapp.com/channel/0029VbE63yoGpLHMT1ikDA0W',
  'https://whatsapp.com/channel/0029Vb9L0jRDDmFMZqKhyn33',
  'https://whatsapp.com/channel/0029Vb9DE5YA89Mbs6DwXu2w',
  'https://whatsapp.com/channel/0029Vb8fl8C9mrGWKx2e5s0Q',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
