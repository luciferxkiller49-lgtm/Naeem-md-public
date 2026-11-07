// Group admin commands: promote, demote, open, close, mute, unmute
// Works with LID (new WhatsApp IDs) aur phone-number dono IDs ke saath.

const userPart = (jid) => String(jid || '').split('@')[0].split(':')[0];

// Participant ki saari pehchaan (LID, phone number, id) — user part ke taur par
function idsOf(p) {
  return [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(userPart);
}
function findParticipant(participants, jid) {
  const u = userPart(jid);
  if (!u) return null;
  return participants.find((p) => idsOf(p).includes(u)) || null;
}
const isAdminP = (p) => !!p && (p.admin === 'admin' || p.admin === 'superadmin');
const tag = (p) => `@${userPart(p.id)}`;

function senderCandidates(msg) {
  return [msg.key.participant, msg.key.participantAlt, msg.key.participantPn].filter(Boolean);
}
function botCandidates(sock) {
  return [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber].filter(Boolean);
}

// Group, permissions aur fresh metadata ek jagah check
async function guard(ctx) {
  const { sock, from, msg, isInstanceOwner } = ctx;
  if (!from.endsWith('@g.us')) {
    await sock.sendMessage(from, { text: '❌ Ye command sirf group mein chalta hai.' });
    return null;
  }
  let meta;
  try {
    meta = await sock.groupMetadata(from);
  } catch (e) {
    await sock.sendMessage(from, { text: '❌ Group ki maloomat nahi mil saki, dobara try karein.' });
    return null;
  }
  const participants = meta.participants || [];

  const senderIsAdmin = senderCandidates(msg).some((j) => isAdminP(findParticipant(participants, j)));
  if (!isInstanceOwner && !senderIsAdmin) {
    await sock.sendMessage(from, { text: '❌ Ye command sirf group admins ke liye hai.' });
    return null;
  }

  const botIsAdmin = botCandidates(sock).some((j) => isAdminP(findParticipant(participants, j)));
  if (!botIsAdmin) {
    await sock.sendMessage(from, { text: '❌ Pehle bot ko group mein admin banayein, phir ye command chalegi.' });
    return null;
  }
  return { meta, participants };
}

// Kis par action karna hai: mention, reply, ya number
function targetJids(ctx) {
  const { msg, args } = ctx;
  const m = msg.message || {};
  const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
  const ci = inner.contextInfo || {};
  const out = [];
  for (const j of ci.mentionedJid || []) out.push(j);
  if (!out.length && ci.participant) out.push(ci.participant);
  if (!out.length) {
    for (const a of args || []) {
      const d = String(a).replace(/[^0-9]/g, '');
      if (d.length >= 7) out.push(`${d}@s.whatsapp.net`);
    }
  }
  return out;
}

function explain(err) {
  const m = String(err?.message || err);
  if (/not-authorized|forbidden|403/i.test(m)) return 'Bot ke paas is kaam ki ijazat nahi (bot admin hona chahiye).';
  if (/rate-overlimit|429/i.test(m)) return 'WhatsApp ne thori der ke liye rok diya, kuch der baad try karein.';
  return m;
}

async function changeRole(ctx, action) {
  const { sock, from, prefix } = ctx;
  const isPromote = action === 'promote';
  const g = await guard(ctx);
  if (!g) return;

  const jids = targetJids(ctx);
  if (!jids.length) {
    return sock.sendMessage(from, {
      text: `${isPromote ? 'Kis ko admin banana hai' : 'Kis ka admin hatana hai'}? Us ka message reply karein ya @mention karein.\nMisal: ${prefix}${action} @user`,
    });
  }

  const doing = [];
  const notes = [];
  for (const j of jids) {
    const p = findParticipant(g.participants, j);
    if (!p) { notes.push(`• ${j.split('@')[0]}: is group mein nahi hai`); continue; }
    if (isPromote && isAdminP(p)) { notes.push(`• ${tag(p)}: pehle se admin hai`); continue; }
    if (!isPromote && !isAdminP(p)) { notes.push(`• ${tag(p)}: admin nahi hai`); continue; }
    if (!isPromote && p.admin === 'superadmin') { notes.push(`• ${tag(p)}: group creator ko demote nahi kar sakte`); continue; }
    if (!doing.some((d) => d.id === p.id)) doing.push(p);
  }

  const mentions = [...doing, ...g.participants.filter((p) => notes.some((n) => n.includes(tag(p))))].map((p) => p.id);
  let text = '';
  if (doing.length) {
    try {
      await sock.groupParticipantsUpdate(from, doing.map((p) => p.id), action);
      text += isPromote
        ? `👑 ${doing.map(tag).join(', ')} ab group admin ${doing.length > 1 ? 'hain' : 'hai'}.`
        : `⬇️ ${doing.map(tag).join(', ')} ab admin nahi ${doing.length > 1 ? 'rahe' : 'raha'}.`;
    } catch (err) {
      text += `❌ ${isPromote ? 'Promote' : 'Demote'} nahi ho saka: ${explain(err)}`;
    }
  }
  if (notes.length) text += `${text ? '\n\n' : ''}${notes.join('\n')}`;
  await sock.sendMessage(from, { text, mentions });
}

async function setAnnounce(ctx, announce) {
  const { sock, from } = ctx;
  const g = await guard(ctx);
  if (!g) return;
  if (!!g.meta.announce === announce) {
    return sock.sendMessage(from, {
      text: announce ? '🔒 Group pehle se band hai (sirf admins message bhej sakte hain).' : '🔓 Group pehle se khula hai (sab message bhej sakte hain).',
    });
  }
  try {
    await sock.groupSettingUpdate(from, announce ? 'announcement' : 'not_announcement');
    await sock.sendMessage(from, {
      text: announce
        ? '🔒 Group band kar diya gaya — ab sirf admins message bhej sakte hain.'
        : '🔓 Group khol diya gaya — ab sab members message bhej sakte hain.',
    });
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ Group setting badal nahi saki: ${explain(err)}` });
  }
}

module.exports = [
  { name: 'promote', description: 'Reply ya @mention kiye gaye member ko admin banata hai', category: 'group', execute: (c) => changeRole(c, 'promote') },
  { name: 'demote', description: 'Reply ya @mention kiye gaye admin ko admin se hata deta hai', category: 'group', execute: (c) => changeRole(c, 'demote') },
  { name: 'open', description: 'Group khol deta hai — sab members message bhej saken', category: 'group', execute: (c) => setAnnounce(c, false) },
  { name: 'close', description: 'Group band karta hai — sirf admins message bhej saken', category: 'group', execute: (c) => setAnnounce(c, true) },
  { name: 'unmute', description: 'Group khol deta hai (.open jaisa)', category: 'group', execute: (c) => setAnnounce(c, false) },
  { name: 'mute', description: 'Group band karta hai (.close jaisa)', category: 'group', execute: (c) => setAnnounce(c, true) },
];
