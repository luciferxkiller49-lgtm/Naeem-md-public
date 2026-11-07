// Group admin commands: promote, demote, open, close, mute, unmute
// Works with LID (new WhatsApp IDs) aur phone-number dono IDs ke saath.
const { tinyBold } = require('../lib/font');

// Har reply "tiny bold" style mein (links, @mentions, IDs apni shakal mein)
const say = (sock, jid, text, extra = {}) => sock.sendMessage(jid, { text: tinyBold(text), ...extra });

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
    await say(sock, from, '❌ This command only works in groups.');
    return null;
  }
  let meta;
  try {
    meta = await sock.groupMetadata(from);
  } catch (e) {
    await say(sock, from, '❌ Could not fetch group info, please try again.');
    return null;
  }
  const participants = meta.participants || [];

  const senderIsAdmin = senderCandidates(msg).some((j) => isAdminP(findParticipant(participants, j)));
  if (!isInstanceOwner && !senderIsAdmin) {
    await say(sock, from, '❌ Only group admins can use this command.');
    return null;
  }

  const botIsAdmin = botCandidates(sock).some((j) => isAdminP(findParticipant(participants, j)));
  if (!botIsAdmin) {
    await say(sock, from, '❌ Please make the bot an admin first.');
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
  if (/not-authorized|forbidden|403/i.test(m)) return 'The bot needs to be an admin to do this.';
  if (/rate-overlimit|429/i.test(m)) return 'WhatsApp rate limit reached, please try again later.';
  return m;
}

async function changeRole(ctx, action) {
  const { sock, from, prefix } = ctx;
  const isPromote = action === 'promote';
  const g = await guard(ctx);
  if (!g) return;

  const jids = targetJids(ctx);
  if (!jids.length) {
    return say(sock, from, `Reply to a user's message or mention them.\nExample: ${prefix}${action} @user`);
  }

  const doing = [];
  const notes = [];
  for (const j of jids) {
    const p = findParticipant(g.participants, j);
    if (!p) { notes.push(`• ${j.split('@')[0]} is not in this group`); continue; }
    if (isPromote && isAdminP(p)) { notes.push(`• ${tag(p)} is already an admin`); continue; }
    if (!isPromote && !isAdminP(p)) { notes.push(`• ${tag(p)} is not an admin`); continue; }
    if (!isPromote && p.admin === 'superadmin') { notes.push(`• ${tag(p)} is the group creator and cannot be demoted`); continue; }
    if (!doing.some((d) => d.id === p.id)) doing.push(p);
  }

  const mentions = [...doing, ...g.participants.filter((p) => notes.some((n) => n.includes(tag(p))))].map((p) => p.id);
  let text = '';
  if (doing.length) {
    try {
      await sock.groupParticipantsUpdate(from, doing.map((p) => p.id), action);
      const who = doing.map(tag).join(', ');
      const many = doing.length > 1;
      text += isPromote
        ? `👑 ${who} ${many ? 'are now admins' : 'is now an admin'}.`
        : `⬇️ ${who} ${many ? 'are' : 'is'} no longer ${many ? 'admins' : 'an admin'}.`;
    } catch (err) {
      text += `❌ Could not ${action} the user: ${explain(err)}`;
    }
  }
  if (notes.length) text += `${text ? '\n\n' : ''}${notes.join('\n')}`;
  await say(sock, from, text, { mentions });
}

async function setAnnounce(ctx, announce) {
  const { sock, from } = ctx;
  const g = await guard(ctx);
  if (!g) return;
  if (!!g.meta.announce === announce) {
    return say(sock, from, announce ? '🔒 Group is already closed, only admins can send messages.' : '🔓 Group is already open, everyone can send messages.');
  }
  try {
    await sock.groupSettingUpdate(from, announce ? 'announcement' : 'not_announcement');
    await say(sock, from, announce
      ? '🔒 Group is now closed, only admins can send messages.'
      : '🔓 Group is now open, everyone can send messages.');
  } catch (err) {
    await say(sock, from, `❌ Could not change group settings: ${explain(err)}`);
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
