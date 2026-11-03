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

module.exports = {
  PORT: process.env.PORT || 5000,
  APP_ID: String(process.env.APP_ID || '1'), // 1 to 10, one per Heroku dyno
  MONGODB_URI: process.env.MONGODB_URI || '',
  PANEL_KEY,

  // Bot Defaults
  BOT_NAME: process.env.BOT_NAME || 'Naeemxlucifer-MD',
  OWNER_NAME: process.env.OWNER_NAME || 'Naeem',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '923000000000',
  DEFAULT_PREFIX: process.env.DEFAULT_PREFIX || '.',
  MAX_LIMIT: Number(process.env.MAX_LIMIT || 50), // 50 active numbers per app, per spec

  MODE: process.env.MODE || 'public',

  // Sticker defaults
  PACK_NAME: process.env.PACK_NAME || 'Naeemxlucifer-MD',
  PACK_AUTHOR: process.env.PACK_AUTHOR || 'Extreme Edition',

  // Delays & Safety
  COMMAND_COOLDOWN_MS: 1500,
  GC_STATUS_DELAY_MS: 3000
};
