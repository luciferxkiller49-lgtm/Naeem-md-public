// Naye number ke pehli baar connect hone par jaane wala video + text message
const fs = require('fs');
const path = require('path');

const BOT_VERSION = '1.0.0';
const VIDEO_PATH = path.join(__dirname, '..', 'assets', 'connect-video.mp4');

const TEMPLATE = [
  "*╔════════════════════╗*",
  "*〔 ☠️ 𝐍𝐀𝐄𝐄𝐌 𝐌𝐃 — 𝐁𝐎𝐓 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 ⚡ 〕*",
  "*╚════════════════════╝*",
  "",
  "*╭─「 ⚔️ 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐈𝐎𝐍 𝐈𝐍𝐅𝐎 」─*",
  "*│ ☠️ 𝐂ᴏɴɴᴇᴄᴛᴇᴅ : {number}*",
  "*│ ⚡ 𝐏ʀᴇғɪx : {prefix}*",
  "*│ 🔒 𝐌ᴏᴅᴇ : {mode}*",
  "*│ 🐧 𝐏ʟᴀᴛғᴏʀᴍ : {platform}*",
  "*│ 🔥 𝐏ʟᴜɢɪɴs : {plugins}*",
  "*│ 🩸 𝐕ᴇʀsɪᴏɴ : {version}*",
  "*╰────────────────────╯*",
  "*☠️ 𝐒𝐘𝐒𝐓𝐄𝐌 𝐒𝐔𝐂𝐂𝐄𝐒𝐒𝐅𝐔𝐋𝐋𝐘 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃*",
  "*⚡ 𝐍𝐀𝐄𝐄𝐌 𝐌𝐃 𝐈𝐒 𝐍𝐎𝐖 𝐀𝐂𝐓𝐈𝐕𝐄*",
  "*🩸 𝐍𝐎 𝐋𝐈𝐌𝐈𝐓𝐒 — 𝐉𝐔𝐒𝐓 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒*",
  "",
  "*𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘*      *NAEEM-MD*"
].join('\n');

const PLATFORMS = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' };

function buildConnectMessage({ number, prefix, mode, plugins }) {
  const text = TEMPLATE
    .replace('{number}', `+${number}`)
    .replace('{prefix}', prefix)
    .replace('{mode}', String(mode || 'public').replace(/^./, (c) => c.toUpperCase()))
    .replace('{platform}', PLATFORMS[process.platform] || process.platform)
    .replace('{plugins}', String(plugins))
    .replace('{version}', BOT_VERSION);
  const hasVideo = fs.existsSync(VIDEO_PATH);
  return { text, videoPath: hasVideo ? VIDEO_PATH : null };
}

module.exports = { buildConnectMessage };
