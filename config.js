require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  APP_ID: String(process.env.APP_ID || '1'), // 1 to 10 corresponding to Heroku dyno/server
  MONGODB_URI: process.env.MONGODB_URI || '',
  PANEL_KEY: process.env.PANEL_KEY || 'naeem_extreme_secret_2026',
  
  // Bot Defaults
  BOT_NAME: process.env.BOT_NAME || 'Naeemxlucifer-MD',
  OWNER_NAME: process.env.OWNER_NAME || 'Naeem',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '923000000000',
  DEFAULT_PREFIX: process.env.DEFAULT_PREFIX || '.',
  MAX_LIMIT: 50, // Specification limit: 50 active WhatsApp numbers per app
  MODE: process.env.MODE || 'public', // 'public' or 'private'
  
  // Sticker defaults
  PACK_NAME: process.env.PACK_NAME || 'Naeemxlucifer-MD',
  PACK_AUTHOR: process.env.PACK_AUTHOR || 'Extreme Edition',
  
  // Delays & Safety (preserves WhatsApp account safety per Section 8)
  COMMAND_COOLDOWN_MS: 1500,
  GC_STATUS_DELAY_MS: 3000
};
