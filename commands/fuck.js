// .fuck — ab sab bot users ke liye, lekin aham shartein:
//   • Bot owner: kahin bhi, kisi bhi group ka link (bot ko join karwa sakta hai), max 50.
//   • Dusre users:
//       - Status mode (.fuck msg,count,link): sirf us group ke ADMIN, aur bot us group ka member hona chahiye
//         (dusre users bot ko kisi group mein join nahi karwa sakte).
//       - Message mode (.fuck,count,msg): sirf us GROUP mein jahan wo khud admin hain (DM mein nahi).
//   Max 50. Message ke beech 250ms, status ke beech 1s (Config Vars se badal sakte hain).
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

const userOf = (j) => String(j || '').split('@')[0].split(':')[0];
const senderJidOf = (msg) => msg?.key?.participant || msg?.key?.participantAlt || msg?.key?.remoteJid;
function isAdminIn(participants, senderJid) {
  const u = userOf(senderJid);
  return participants.some((p) => !!p.admin && [p.id, p.lid, p.phoneNumber, p.jid].some((x) => userOf(x) === u));
}

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

// Link se group pakdo. Join sirf owner karwa sakta hai.
async function resolveGroup(sock, code, allowJoin) {
  let info;
  try { info = await sock.groupGetInviteInfo(code); }
  catch (e) { return { err: `Link se group ki maloomat nahi mili (${e.message || 'link expire ya galat'}).` }; }
  const gid = info?.id;
  if (!gid) return { err: 'Group nahi mila (link expire ya galat ho sakta hai).' };

  const meta = await sock.groupMetadata(gid).catch(() => null);
  if (meta) return { gid, subject: meta.subject || info.subject || 'group', meta, joined: false };
  if (!allowJoin) return { err: 'Bot us group ka member nahi hai. Pehle bot ko us group mein add karwayein.' };

  try { await sock.groupAcceptInvite(code); }
  catch (e) { return { err: `Bot us group ka member nahi hai aur link se join nahi ho saka (${e.message || 'unknown'}).` }; }
  const meta2 = await sock.groupMetadata(gid).catch(() => null);
  if (!meta2) return { err: 'Bot group join ho gaya lekin group ki maloomat nahi mili. Dobara try karein.' };
  return { gid, subject: meta2.subject || info.subject || 'group', meta: meta2, joined: true };
}

// ---- chat mein message ----
async function messageMode(ctx, rest) {
  const parts = rest.split(',');
  const count = parseCount(parts[0]);
  const message = parts.slice(1).join(',').trim();
  if (!count || !message) return ctx.reply(USAGE);
  const total = Math.min(count, MAX);
  const note = count > MAX ? `\n⚠️ Max ${MAX} hai, ${MAX} bheje ja rahe hain.` : '';
  let ok = 0;
  for (let i = 0; i < total; i++) {
    try { await ctx.sock.sendMessage(ctx.from, { text: message }); ok++; }
    catch (e) { console.error('[FUCK] message failed:', e.message); }
    if (i < total - 1) await sleep(MSG_GAP_MS);
  }
  return ctx.reply(`✅ ${ok}/${total} message bheje.${note}`);
}

// ---- group status ----
async function statusMode(ctx, text, isOwnerUser) {
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

  const g = await resolveGroup(ctx.sock, code, isOwnerUser);
  if (g.err) return ctx.reply(`❌ ${g.err}`);
  const { gid, subject, meta, joined } = g;

  if (!isOwnerUser && !isAdminIn(meta.participants || [], senderJidOf(ctx.msg))) {
    return ctx.reply(`❌ Aap ${subject} ke admin nahi hain, is liye us mein status nahi lag sakta.`);
  }
  const joinNote = joined ? '\n(Bot ne is link se group join kiya.)' : '';

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

  await ctx.reply(`⏳ ${subject} mein ${total} status lagaye ja rahe hain...`);

  let ok = 0; let streak = 0; let lastErr = '';
  const attempt = async () => {
    try { await postGroupStatus(ctx.sock, gid, payload); return true; }
    catch (e) { lastErr = String(e?.message || e); console.error('[FUCK] status failed:', lastErr); return false; }
  };
  for (let i = 0; i < total; i++) {
    let posted = await attempt();
    if (!posted && /rate-overlimit/i.test(lastErr)) { await sleep(10000); posted = await attempt(); }
    if (posted) { ok++; streak = 0; } else { streak++; if (streak >= 5) break; } // 5 lagatar fail -> ruk jao
    if (i < total - 1) await sleep(STATUS_GAP_MS);
  }

  const stopNote = streak >= 5 ? ' (5 lagatar fail ki wajah se ruk gaye)' : '';
  if (!ok) return ctx.reply(`❌ ${subject} mein status post nahi hue${stopNote}.\nWajah: ${lastErr || 'nahi pata'}${joinNote}`);
  return ctx.reply(`✅ ${subject} mein ${ok}/${total} status post hue${stopNote}.${capNote}${joinNote}`);
}

module.exports = [
  {
    name: 'fuck',
    aliases: [],
    description: 'Group status (.fuck msg,count,link) ya message bar bar (.fuck,count,msg). Owner: sab; dusre: group admin',
    category: 'owner',
    async execute(ctx) {
      const isOwnerUser = !!(ctx.isInstanceOwner || ctx.isOwner);
      // dispatcher ".fuck,5,hi" ko args [",5,hi"] bana deta hai (comma wali shakl)
      const text = (ctx.args || []).join(' ').trim();
      if (!text) return ctx.reply(USAGE);
      if (text.startsWith(',')) {
        if (!isOwnerUser && !(ctx.isGroup && ctx.isAdmin)) {
          return ctx.reply('❌ Message mode sirf us group mein chalta hai jahan aap admin hain.');
        }
        return messageMode(ctx, text.slice(1));
      }
      return statusMode(ctx, text, isOwnerUser);
    },
  },
];
