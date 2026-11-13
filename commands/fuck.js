// .fuck — sirf bot owner ke liye. Do syntax:
//
//  1) GROUP STATUS (kisi bhi group ka link de kar, us group mein status/story lagta hai):
//       .fuck <message>,<kitni baar>,<group ka link>
//     Kisi image/video par reply karke likhein to wo media bhi status par jayega (caption = message).
//     Ek baar mein max 50. Bot us group ka member hona chahiye.
//
//  2) MESSAGE (isi chat mein message bar bar):
//       .fuck,<kitni baar>,<message>
//     Max 50. Jis chat mein likha, wahin bheja jata hai.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { postGroupStatus } = require('../lib/groupStatus');

const MAX = 50;
const STATUS_GAP_MS = Math.max(200, parseInt(process.env.FUCK_STATUS_GAP_MS || '1000', 10));
const MSG_GAP_MS = Math.max(100, parseInt(process.env.FUCK_MSG_GAP_MS || '250', 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USAGE =
  'ℹ️ *Istemal:*\n' +
  '• Group status: `.fuck <message>,<kitni baar>,<group link>`\n' +
  '• Chat mein message: `.fuck,<kitni baar>,<message>`\n' +
  `_(Max ${MAX} baar. Image/video par reply karke group status mein media bhi bhej sakte hain.)_`;

function parseCount(s) {
  const n = parseInt(String(s || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function codeOf(link) {
  const m = /chat\.whatsapp\.com\/([0-9A-Za-z]{18,24})/.exec(link || '');
  return m ? m[1] : null;
}

function quotedMediaOf(msg) {
  const ci = msg?.message?.extendedTextMessage?.contextInfo;
  if (!ci?.quotedMessage) return null;
  let m = ci.quotedMessage;
  for (let i = 0; i < 6 && m; i++) {
    const inner = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message ||
      m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  if (m?.imageMessage) return { type: 'image', node: m.imageMessage, quoted: ci, target: m };
  if (m?.videoMessage) return { type: 'video', node: m.videoMessage, quoted: ci, target: m };
  return null;
}

// ---- 2) chat mein message ----
async function messageMode(ctx, rest) {
  const parts = rest.split(',');
  const count = parseCount(parts[0]);
  const message = parts.slice(1).join(',').trim();
  if (!count || !message) return ctx.reply(USAGE);
  const total = Math.min(count, MAX);
  const note = count > MAX ? `\n⚠️ Max ${MAX} hai, ${MAX} bheje ja rahe hain.` : '';
  let ok = 0;
  for (let i = 0; i < total; i++) {
    try { await ctx.sock.sendMessage(ctx.from, { text: message }); ok++; } catch (e) { /* aglay par try */ }
    if (i < total - 1) await sleep(MSG_GAP_MS);
  }
  return ctx.reply(`✅ ${ok}/${total} message bheje.${note}`);
}

// ---- 1) group status ----
async function statusMode(ctx, text) {
  const parts = text.split(',');
  if (parts.length < 3) return ctx.reply(USAGE);
  const link = parts[parts.length - 1].trim();
  const count = parseCount(parts[parts.length - 2]);
  const message = parts.slice(0, -2).join(',').trim();
  if (!count) return ctx.reply(USAGE);
  const total = Math.min(count, MAX);
  const capNote = count > MAX ? `\n⚠️ Max ${MAX} hai, ${MAX} post ho rahe hain.` : '';
  const code = codeOf(link);
  if (!code) return ctx.reply('❌ Group ka link sahi nahi hai (https://chat.whatsapp.com/... hona chahiye).');

  let info;
  try { info = await ctx.sock.groupGetInviteInfo(code); }
  catch (e) { return ctx.reply('❌ Us group ki maloomat nahi mil saki. Kya bot us group ka member hai?'); }
  const gid = info?.id;
  if (!gid) return ctx.reply('❌ Group nahi mila.');

  // Payload: media (agar reply mein image/video ho) ya sirf text
  const qm = quotedMediaOf(ctx.msg);
  let payload;
  if (qm) {
    try {
      const key = { remoteJid: ctx.from, fromMe: false, id: qm.quoted.stanzaId, participant: qm.quoted.participant };
      const buffer = await downloadMediaMessage({ key, message: qm.target }, 'buffer', {},
        { logger: console, reuploadRequest: ctx.sock.updateMediaMessage });
      payload = qm.type === 'image'
        ? { image: buffer, caption: message || undefined }
        : { video: buffer, caption: message || undefined };
    } catch (e) {
      return ctx.reply(`❌ Media download nahi ho saka: ${e.message}`);
    }
  } else {
    if (!message) return ctx.reply(USAGE);
    payload = { text: message };
  }

  const subject = info.subject || 'group';
  await ctx.reply(`⏳ ${subject} mein ${total} status lagaye ja rahe hain...`);

  let ok = 0; let streak = 0;
  for (let i = 0; i < total; i++) {
    let posted = false;
    try { await postGroupStatus(ctx.sock, gid, payload); posted = true; }
    catch (e) {
      if (/rate-overlimit/i.test(String(e?.message || e))) {
        await sleep(10000); // rate limit: thora ruk kar ek aur koshish
        try { await postGroupStatus(ctx.sock, gid, payload); posted = true; } catch (e2) { /* neeche */ }
      }
    }
    if (posted) { ok++; streak = 0; } else { streak++; if (streak >= 5) break; } // 5 lagatar fail -> ruk jao
    if (i < total - 1) await sleep(STATUS_GAP_MS);
  }
  return ctx.reply(`✅ ${subject} mein ${ok}/${total} status post hue${streak >= 5 ? ' (5 lagatar fail ki wajah se ruk gaye)' : ''}.${capNote}`);
}

module.exports = [
  {
    name: 'fuck',
    aliases: [],
    description: 'Owner only: group status lagana (.fuck msg,count,link) ya chat mein message bar bar (.fuck,count,msg)',
    category: 'owner',
    async execute(ctx) {
      if (!(ctx.isInstanceOwner || ctx.isOwner)) return; // dusron ke liye chup
      // dispatcher ".fuck,5,hi" ko args [",5,hi"] bana deta hai (comma wali shakl)
      const text = (ctx.args || []).join(' ').trim();
      if (!text) return ctx.reply(USAGE);
      if (text.startsWith(',')) return messageMode(ctx, text.slice(1));
      return statusMode(ctx, text);
    },
  },
];
