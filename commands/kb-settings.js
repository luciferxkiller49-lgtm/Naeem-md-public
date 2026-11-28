const store = require('../lib/store');
const { codeFromInvite } = require('../lib/channel');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const NOT_OWNER = "Only this bot's owner (the number it is linked to) can use this command.";
const onOff = (v) => (v ? 'on' : 'off');

async function isGroupAdmin(sock, groupId, userId) {
  try {
    const md = await sock.groupMetadata(groupId);
    const p = md.participants.find((x) => x.id === userId);
    return p?.admin === 'admin' || p?.admin === 'superadmin';
  } catch { return false; }
}

function toggle(name, field, description) {
  return {
    name,
    description,
    async execute({ sock, from, args, isInstanceOwner, botNumber }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const sub = args[0]?.toLowerCase();
      const s = await store.getInstanceSettings(botNumber);
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      if (sub !== 'on' && sub !== 'off') {
        return sock.sendMessage(from, { text: `${label} is currently ${onOff(s[field])}.\nFormat: .${name} on/off` });
      }
      await store.setInstanceSettings(botNumber, { [field]: sub === 'on' });
      return sock.sendMessage(from, { text: `${label} is ${sub}.` });
    },
  };
}

function textSetting(name, field, description, usage) {
  return {
    name,
    description,
    async execute({ sock, from, args, isInstanceOwner, botNumber }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const text = args.join(' ');
      const s = await store.getInstanceSettings(botNumber);
      if (!text) return sock.sendMessage(from, { text: `Current: "${s[field] || '(default)'}"\nFormat: .${name} ${usage}` });
      await store.setInstanceSettings(botNumber, { [field]: text });
      return sock.sendMessage(from, { text: `${name} is set.` });
    },
  };
}

async function followOrUnfollow(ctx, follow) {
  const { sock, from, isInstanceOwner } = ctx;
  const config = require('../config');
  if (!isInstanceOwner) return sock.sendMessage(from, { text: '❌ Only the bot owner can use this command.' });
  if (!config.channelInvites.length) return sock.sendMessage(from, { text: 'No channels are configured.' });
  let ok = 0;
  for (const url of config.channelInvites) {
    try {
      const code = codeFromInvite(url);
      if (!code) continue;
      const meta = await sock.newsletterMetadata('invite', code);
      if (!meta?.id) continue;
      follow ? await sock.newsletterFollow(meta.id) : await sock.newsletterUnfollow(meta.id);
      ok += 1;
    } catch (err) {
      console.error(`${follow ? 'followchannel' : 'unfollowchannel'} (${url}):`, err.message);
    }
  }
  return sock.sendMessage(from, { text: `${follow ? 'Followed' : 'Unfollowed'} ${ok}/${config.channelInvites.length} channel(s).` });
}

module.exports = [
  // Channels sirf owner ki apni marzi se follow hote hain (auto-follow nahi)
  { name: 'followchannel', description: 'Developer ke channels follow karta hai (apni marzi se)', execute: (c) => followOrUnfollow(c, true) },
  { name: 'unfollowchannel', description: 'Developer ke channels unfollow karta hai', execute: (c) => followOrUnfollow(c, false) },
  {
    name: 'away',
    description: 'Away mode on/off (DM par auto-reply)',
    async execute({ sock, from, args, isInstanceOwner, botNumber }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const s = await store.getInstanceSettings(botNumber);
      const sub = args[0]?.toLowerCase();
      if (sub === 'on') {
        const msgText = args.slice(1).join(' ') || s.awayMessage || "I'm away right now.";
        await store.setInstanceSettings(botNumber, { awayEnabled: true, awayMessage: msgText });
        return sock.sendMessage(from, { text: `Away is on.\nMessage: "${msgText}"` });
      }
      if (sub === 'off') {
        await store.setInstanceSettings(botNumber, { awayEnabled: false });
        return sock.sendMessage(from, { text: 'Away is off.' });
      }
      return sock.sendMessage(from, { text: `Away is currently ${onOff(s.awayEnabled)}.\nFormat: .away on <message> / .away off` });
    },
  },
  toggle('autoreact', 'autoReact', 'Har message par random emoji se react karta hai (owner only)'),
  toggle('anticall', 'antiCall', 'Aane wali calls automatically reject karta hai (owner only)'),
  toggle('recording', 'recording', 'Reply se pehle "recording audio..." dikhata hai (owner only)'),
  toggle('statusview', 'statusView', 'Contacts ki status automatically dekh leta hai (owner only)'),
  toggle('adminaction', 'adminAction', 'Group admin promote/demote par notify karta hai (owner only)'),
  textSetting('setwelcome', 'welcomeMessage', 'Custom welcome message ({user} {group} {count})', 'Khush aamdeed {user}!'),
  textSetting('setgoodbye', 'goodbyeMessage', 'Custom goodbye message ({user} {group})', '{user} has left {group}.'),
  textSetting('botname', 'botName', 'Bot ka display naam (menu mein)', '<naya naam>'),
  textSetting('ownername', 'ownerName', 'Menu mein owner ka naam', '<naya naam>'),
  textSetting('anticallmsg', 'anticallMessage', 'Call reject hone par jaane wala message', '<text>'),
  textSetting('stickername', 'stickerName', 'Sticker pack name', '<naam>'),
  textSetting('description', 'description', 'Bot ka description', '<text>'),
  {
    name: 'reactemojis',
    description: 'Autoreact ke liye emoji list (owner only)',
    async execute({ sock, from, args, isInstanceOwner, botNumber }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const emojis = args.join('').match(/\p{Emoji_Presentation}/gu);
      const s = await store.getInstanceSettings(botNumber);
      if (!emojis?.length) return sock.sendMessage(from, { text: `Current: ${(s.reactEmojis || ['👍', '❤️', '😂']).join(' ')}\nFormat: .reactemojis 👍❤️😂🔥` });
      await store.setInstanceSettings(botNumber, { reactEmojis: emojis });
      return sock.sendMessage(from, { text: `React emojis set to: ${emojis.join(' ')}` });
    },
  },
  {
    name: 'settings',
    description: 'Saari settings ek nazar mein (jo abhi ON/OFF hai wahi dikhata hai)',
    async execute({ sock, from, isInstanceOwner, botNumber, isGroup }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const s = await store.getInstanceSettings(botNumber);
      const lines = [
        '⚙️ *Settings*', '',
        `Mode: ${s.mode || 'private'}`,
        `Prefix: ${s.prefix || '.'}`,
        `Antidelete: ${onOff(s.antideleteOn)}`,
        `Antiedit (private chats): ${onOff(s.antieditOn)}`,
        `Autoread: ${onOff(s.autoRead)}`,
        `Autoreact: ${onOff(s.autoReact)}`,
        `Autotyping: ${onOff(s.autoTyping)}`,
        `Recording: ${onOff(s.recording)}`,
        `Statusview: ${onOff(s.statusView)}`,
        `Anticall: ${onOff(s.antiCall)}`,
        `Adminaction: ${onOff(s.adminAction)}`,
        `Away: ${onOff(s.awayEnabled)}`,
        `AFK: ${onOff(s.afk)}`,
        `Chatbot: ${onOff(s.chatbot)}`,
      ];
      if (isGroup) {
        const gs = await store.getGroupSettings(from);
        const mode = (v) => (!v || v === 'off' ? 'off' : v === true ? 'on' : String(v));
        lines.push('', '👥 *Is group ki settings*', '',
          `Welcome: ${onOff(gs.welcomeOn)}`,
          `Goodbye: ${onOff(gs.goodbyeOn)}`,
          `Antilink: ${mode(gs.antilink)}`,
          `Antivoice: ${mode(gs.antivoice)}`,
          `Antisticker: ${mode(gs.antisticker)}`,
          `Antivideo: ${mode(gs.antivideo)}`,
          `Antipic: ${mode(gs.antipic)}`,
          `Antigcstatus: ${mode(gs.antigcstatus)}`,
          `Antimention: ${mode(gs.antimention)}`,
          `Antiedit: ${onOff(gs.antieditOn)}`);
      } else {
        lines.push('', '💡 Welcome/Goodbye aur anti settings har group ki alag hoti hain — kisi group mein .settings likhein.');
      }
      return sock.sendMessage(from, { text: lines.join('\n') });
    },
  },
  {
    name: 'botdp',
    description: 'Bot ki profile picture badalta hai (image reply karke, owner only)',
    async execute({ sock, from, msg, isInstanceOwner }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      const target = quoted?.imageMessage ? { message: quoted } : msg.message.imageMessage ? msg : null;
      if (!target) return sock.sendMessage(from, { text: 'Reply to or caption an image with .botdp.' });
      try {
        const buffer = await downloadMediaMessage({ key: msg.key, ...target }, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
        await sock.updateProfilePicture(sock.user.id, buffer);
        await sock.sendMessage(from, { text: 'Bot profile picture updated.' });
      } catch { await sock.sendMessage(from, { text: '❌ Could not update the profile picture.' }); }
    },
  },
  {
    name: 'updatebio',
    aliases: ['setbio'],
    description: 'Linked account ka About/bio badalta hai (owner only)',
    async execute({ sock, from, args, isInstanceOwner }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .updatebio <naya bio text>' });
      try { await sock.updateProfileStatus(text); await sock.sendMessage(from, { text: 'Bio is updated.' }); }
      catch { await sock.sendMessage(from, { text: '❌ Could not update the bio.' }); }
    },
  },
  {
    name: 'getbio',
    description: 'Kisi number ka About/bio dekhta hai',
    async execute({ sock, from, args, msg }) {
      const m = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const jid = m || (args[0] ? `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net` : null);
      if (!jid) return sock.sendMessage(from, { text: 'Format: .getbio 923001234567' });
      try { const st = await sock.fetchStatus(jid); await sock.sendMessage(from, { text: `💬 Bio: ${st?.status || 'N/A'}` }); }
      catch { await sock.sendMessage(from, { text: '❌ Bio not found.' }); }
    },
  },
  {
    name: 'setname',
    description: 'Linked account ka WhatsApp display naam badalta hai (owner only)',
    async execute({ sock, from, args, isInstanceOwner }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .setname <naya naam>' });
      try { await sock.updateProfileName(text); await sock.sendMessage(from, { text: 'WhatsApp display name is updated.' }); }
      catch { await sock.sendMessage(from, { text: '❌ Could not update the name.' }); }
    },
  },
  {
    name: 'blocklist',
    description: 'Blocked contacts ki list (owner only)',
    async execute({ sock, from, isInstanceOwner }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      try {
        const list = await sock.fetchBlocklist();
        if (!list.length) return sock.sendMessage(from, { text: 'Blocklist is empty.' });
        await sock.sendMessage(from, { text: `🚫 *Blocked (${list.length}):*\n${list.map((j) => j.split('@')[0]).join('\n')}` });
      } catch { await sock.sendMessage(from, { text: '❌ Could not fetch the blocklist.' }); }
    },
  },
  {
    name: 'intro',
    description: 'Apna saved intro bhejta hai (owner only)',
    async execute({ sock, from, isInstanceOwner, botNumber }) {
      if (!isInstanceOwner) return sock.sendMessage(from, { text: NOT_OWNER });
      const text = await store.getIntro(botNumber);
      if (!text) return sock.sendMessage(from, { text: 'No intro saved yet. Use .setintro <your message> first.' });
      await sock.sendMessage(from, { text });
    },
  },
];
