const store = require('../lib/store');

const digits = (n) => (n || '').replace(/[^0-9]/g, '');

function pickTarget(msg, args) {
  const ci = msg.message.extendedTextMessage?.contextInfo;
  const t = ci?.mentionedJid?.[0] || ci?.participant || (args[0] ? `${digits(args[0])}@s.whatsapp.net` : null);
  return t ? `${digits(t.split('@')[0].split(':')[0])}@s.whatsapp.net` : null;
}

async function edit(ctx, field, add) {
  const { sock, msg, from, args, botNumber, isInstanceOwner } = ctx;
  if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
  const target = pickTarget(msg, args);
  if (!target) return sock.sendMessage(from, { text: 'Mention, reply to, or provide the number of a user.' });
  const s = await store.getInstanceSettings(botNumber);
  const set = new Set(s[field] || []);
  add ? set.add(target) : set.delete(target);
  await store.setInstanceSettings(botNumber, { [field]: Array.from(set) });
  const label = field === 'banList' ? 'Ban' : 'Sudo';
  return sock.sendMessage(from, { text: `${label} is ${add ? 'on' : 'off'} for @${target.split('@')[0]}.`, mentions: [target] });
}

async function list(ctx, field, title) {
  const { sock, from, botNumber, isInstanceOwner } = ctx;
  if (!isInstanceOwner) return sock.sendMessage(from, { text: 'Only the owner can use this command.' });
  const arr = (await store.getInstanceSettings(botNumber))[field] || [];
  if (!arr.length) return sock.sendMessage(from, { text: 'List is empty.' });
  return sock.sendMessage(from, { text: `${title}\n\n${arr.map((j) => `@${j.split('@')[0]}`).join('\n')}`, mentions: arr });
}

module.exports = [
  { name: 'ban', description: 'User ko is bot ke liye ban karta hai (reply/mention se)', execute: (c) => edit(c, 'banList', true) },
  { name: 'unban', description: 'User ko unban karta hai', execute: (c) => edit(c, 'banList', false) },
  { name: 'banlist', description: 'Sab banned users ki list', execute: (c) => list(c, 'banList', '🚫 *Banned Users*') },
  { name: 'sudo', description: 'User ko sudo (owner-level access) deta hai', execute: (c) => edit(c, 'sudoList', true) },
  { name: 'delsudo', description: 'Sudo access hataata hai', execute: (c) => edit(c, 'sudoList', false) },
  { name: 'listsudo', description: 'Sab sudo users ki list', execute: (c) => list(c, 'sudoList', '👑 *Sudo Users*') },
];
