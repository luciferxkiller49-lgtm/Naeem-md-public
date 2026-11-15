// Welcome / goodbye ka text. {user} = member ka tag, {group} = group ka naam.
// Footer mein bot ka signature hai (purana "NAEEM-MD" text hata diya gaya hai).
// Welcome mein "read more" fold: header, member tag aur DP ke baad ka hissa WhatsApp mein chhupa rehta hai.
const { SIGNATURE } = require('./signature');

// WhatsApp ko text lamba dikhane ke liye invisible characters (read more ke liye)
const FOLD = '\u200e'.repeat(4001);

const WELCOME_BODY = `𓆩🖤𓆪 𝐇𝐄𝐘 𝐃𝐄𝐀𝐑, 𝐒𝐎 𝐆𝐋𝐀𝐃 𝐓𝐎 𝐇𝐀𝐕𝐄 𝐘𝐎𝐔 𝐇𝐄𝐑𝐄! 🥹✨

⏤͟͟͞⃝♡ 𝐋𝐄𝐓 𝐆𝐎 𝐎𝐅 𝐘𝐎𝐔𝐑 𝐖𝐎𝐑𝐑𝐈𝐄𝐒,
𝐁𝐑𝐈𝐍𝐆 𝐘𝐎𝐔𝐑 𝐒𝐌𝐈𝐋𝐄 & 𝐒𝐏𝐑𝐄𝐀𝐃 𝐆𝐎𝐎𝐃 𝐕𝐈𝐁𝐄𝐒! 🦋

𓆩🌸𓆪 𝐌𝐄𝐄𝐓 𝐍𝐄𝐖 𝐏𝐄𝐎𝐏𝐋𝐄 • 𝐌𝐀𝐊𝐄 𝐍𝐄𝐖 𝐌𝐄𝐌𝐎𝐑𝐈𝐄𝐒 • 𝐄𝐍𝐉𝐎𝐘 𝐄𝐕𝐄𝐑𝐘 𝐌𝐎𝐌𝐄𝐍𝐓! 💫

٭◌ آج ســـۛۤ᷼ــے آپ بـــۛۤ᷼ــھی ہـــۛۤ᷼ــمـــۛۤ᷼ــاری اس خـــۛۤ᷼ــوبـــۛۤ᷼ــصـــۛۤ᷼ــورت مـــۛۤ᷼ــحـــۛۤ᷼ــفـــۛۤ᷼ــل کـــۛۤ᷼ــا حـــۛۤ᷼ــصـــۛۤ᷼ــہ ہـــۛۤ᷼ــیـــۛۤ᷼ــں 🥹🌹

𓆩🥀𓆪 𝐅𝐄𝐄𝐋 𝐀𝐓 𝐇𝐎𝐌𝐄, 𝐁𝐄 𝐘𝐎𝐔𝐑𝐒𝐄𝐋𝐅 & 𝐊𝐄𝐄𝐏 𝐒𝐇𝐈𝐍𝐈𝐍𝐆! 🖤`;

const GOODBYE_BODY = `𓆩🥀𓆪 𝐆𝐎𝐎𝐃 𝐁𝐘𝐄, 𝐌𝐘 𝐃𝐄𝐀𝐑 🖤✨

٭◌ جـــۛۤ᷼ــانـــۛۤ᷼ــا، خـــۛۤ᷼ــیـــۛۤ᷼ــال رکـــۛۤ᷼ــھـــۛۤ᷼ــنـــۛۤ᷼ــا…
مـــۛۤ᷼ــلـــۛۤ᷼ــیـــۛۤ᷼ــں گـــۛۤ᷼ــے پـــۛۤ᷼ــھـــۛۤ᷼ــر ❤️🥀

⏤͟͟͞⃝⃪𝆺𝅥 𝐒𝐭𝐚𝐲 𝐇𝐚𝐩𝐩𝐲 • 𝐊𝐞𝐞𝐩 𝐒𝐦𝐢𝐥𝐢𝐧𝐠 • 𝐓𝐚𝐤𝐞 𝐂𝐚𝐫𝐞 🦋𝆺𝅥⃝𝄟

𓆩🖤𓆪 𝐘𝐎𝐔'𝐋𝐋 𝐀𝐋𝐖𝐀𝐘𝐒 𝐁𝐄 𝐏𝐀𝐑𝐓 𝐎𝐅 𝐎𝐔𝐑 𝐌𝐄𝐌𝐎𝐑𝐈𝐄𝐒 🌹`;

// Welcome: header + {user} (DP ke neeche), phir fold, phir baaqi text, phir signature
const WELCOME_TEMPLATE =
  `{user}\n𓆩🥀𓆪 ꯭ं٭ 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 {group} ٭ ꯭🦋\n${FOLD}\n` +
  `𝆺𝅥🥀 ꯭ं٭ 𝐀 𝐍𝐄𝐖 𝐅𝐀𝐂𝐄, 𝐀 𝐍𝐄𝐖 𝐒𝐓𝐎𝐑𝐘 ٭ ꯭🦋𝆺𝅥\n\n` +
  `${WELCOME_BODY}\n\n${SIGNATURE}`;

// Goodbye: {user} phir text, phir signature
const GOODBYE_TEMPLATE = `{user}\n${GOODBYE_BODY}\n\n${SIGNATURE}`;

function render(template, { user = '', group = '' } = {}) {
  return template.split('{user}').join(user).split('{group}').join(group);
}

module.exports = { WELCOME_TEMPLATE, GOODBYE_TEMPLATE, render, FOLD };
