// Check karta hai ke message bhejne wala group admin hai ya nahi
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { findParticipant, isAdminP } = require('../lib/groupUtil');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// LID ho ya number, dono tarah ke participant ko pehchanta hai (pehle sirf p.id === userId tha)
async function isAdmin(sock, groupId, userId) {
  const metadata = await sock.groupMetadata(groupId);
  return isAdminP(findParticipant(metadata.participants, userId));
}

function getMentioned(msg) {
  return msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

module.exports = [
  {
    name: 'add',
    description: 'Group mein naya member add karta hai (admin only)',
    execute: async (ctx) => {
      const { sock, from, args } = ctx;
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      if (!(ctx.isAdmin || ctx.isInstanceOwner)) return sock.sendMessage(from, { text: 'Only admins can use this command.' });
      if (!ctx.isBotAdmin) return sock.sendMessage(from, { text: '❌ Pehle bot ko group admin banayein, tabhi member add ho sakta hai.' });

      const number = args[0]?.replace(/[^0-9]/g, '');
      if (!number) return sock.sendMessage(from, { text: 'Number likhein. e.g. .add 923001234567' });
      if (number.length < 8 || number.length > 15) return sock.sendMessage(from, { text: '❌ Number sahi nahi hai. Country code ke saath likhein, e.g. .add 923001234567' });

      try {
        const res = await sock.groupParticipantsUpdate(from, [`${number}@s.whatsapp.net`], 'add');
        const st = String(res?.[0]?.status ?? '200');
        if (st.startsWith('2')) return sock.sendMessage(from, { text: `✅ +${number} group mein add ho gaya.` });
        const why = {
          '409': 'ye number pehle se group mein hai.',
          '403': 'is number ki privacy setting direct add nahi hone deti. Group ka invite link bhej dein.',
          '408': 'ye number haal hi mein group chhod chuka hai, thori der baad try karein.',
          '401': 'is number ne group/bot ko block kiya hua hai.',
          '404': 'ye number WhatsApp par nahi mila.',
          '400': 'ye number WhatsApp par nahi mila.',
          '500': 'WhatsApp ne request reject kar di, thori der baad try karein.',
        }[st] || `WhatsApp ne add nahi hone diya (code ${st}).`;
        return sock.sendMessage(from, { text: `❌ +${number} add nahi hua: ${why}` });
      } catch (err) {
        console.error('[ADD] failed:', err.message);
        return sock.sendMessage(from, { text: `❌ Add nahi ho saka: ${err.message}` });
      }
    },
  },
  {
    name: 'tagall',
    description: 'Sab group members ko tag karta hai (koi bhi member use kar sakta hai)',
    execute: async ({ sock, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const metadata = await sock.groupMetadata(from);
      const mentions = metadata.participants.map((p) => p.id);
      const text = args.join(' ') || 'Tag all members';
      const mentionText = mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
      await sock.sendMessage(from, { text: `${text}\n\n${mentionText}`, mentions });
    },
  },
  {
    name: 'hidetag',
    description: 'Sab members ko silently (bina naam dikhaye) tag karta hai (koi bhi member use kar sakta hai)',
    execute: async ({ sock, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const metadata = await sock.groupMetadata(from);
      const mentions = metadata.participants.map((p) => p.id);
      const text = args.join(' ') || '.';
      await sock.sendMessage(from, { text, mentions });
    },
  },
  {
    name: 'tagadmins',
    description: 'Sirf group admins ko tag karta hai',
    execute: async ({ sock, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const metadata = await sock.groupMetadata(from);
      const admins = metadata.participants.filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return sock.sendMessage(from, { text: 'No admins found.' });
      const text = args.join(' ') || 'Attention admins';
      const mentionText = admins.map((m) => `@${m.split('@')[0]}`).join(' ');
      await sock.sendMessage(from, { text: `${text}\n\n${mentionText}`, mentions: admins });
    },
  },
  {
    name: 'link',
    aliases: ['ginvitelink'],
    description: 'Group ka invite link deta hai (admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) {
        return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      }
      try {
        const code = await sock.groupInviteCode(from);
        await sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Could not get the link.' });
      }
    },
  },
  {
    name: 'revoke',
    description: 'Group ka purana invite link cancel karke naya banata hai (admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) {
        return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      }
      try {
        const code = await sock.groupRevokeInvite(from);
        await sock.sendMessage(from, { text: `🔗 New link: https://chat.whatsapp.com/${code}` });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Could not revoke the link.' });
      }
    },
  },
  {
    name: 'ginfo',
    aliases: ['groupinfo'],
    description: 'Group ki details dikhata hai',
    execute: async ({ sock, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const metadata = await sock.groupMetadata(from);
      const admins = metadata.participants.filter((p) => p.admin).length;
      await sock.sendMessage(from, {
        text:
          `📋 *${metadata.subject}*\n` +
          `Members: ${metadata.participants.length}\n` +
          `Admins: ${admins}\n` +
          `Created: ${new Date(metadata.creation * 1000).toDateString()}\n` +
          (metadata.desc ? `Description: ${metadata.desc}` : ''),
      });
    },
  },
  {
    name: 'delete',
    aliases: ['del'],
    description: 'Reply kiye gaye message ko delete karta hai (admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) {
        return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      }
      const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
      const quotedId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
      if (!quotedId) return sock.sendMessage(from, { text: 'Delete karne wale message par reply karein.' });
      try {
        await sock.sendMessage(from, {
          delete: { remoteJid: from, id: quotedId, participant: quotedParticipant, fromMe: false },
        });
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Could not delete.' });
      }
    },
  },
  {
    name: 'out',
    description: 'Bot is group se khud nikal jata hai (owner only)',
    execute: async ({ sock, from, isInstanceOwner }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }
      await sock.sendMessage(from, { text: '👋 Bye!' });
      await sock.groupLeave(from);
    },
  },
  {
    name: 'updategdesc',
    description: 'Group ka description badalta hai (admin only)',
    execute: async ({ sock, msg, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .updategdesc <naya description>' });
      try {
        await sock.groupUpdateDescription(from, text);
        await sock.sendMessage(from, { text: 'Group description updated.' });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not update the description.' });
      }
    },
  },
  {
    name: 'updategname',
    description: 'Group ka naam badalta hai (admin only)',
    execute: async ({ sock, msg, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .updategname <naya naam>' });
      try {
        await sock.groupUpdateSubject(from, text);
        await sock.sendMessage(from, { text: 'Group name updated.' });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not update the group name.' });
      }
    },
  },
  {
    name: 'gcpp',
    description: 'Group ki profile picture badalta hai (image reply karke, admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) return sock.sendMessage(from, { text: 'Only group admins can use this command.' });

      const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      const target = quoted?.imageMessage ? { message: quoted } : msg.message.imageMessage ? msg : null;
      if (!target) return sock.sendMessage(from, { text: 'Reply to or caption an image with .gcpp.' });

      try {
        const buffer = await downloadMediaMessage(
          { key: msg.key, ...target },
          'buffer',
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );
        await sock.updateProfilePicture(from, buffer);
        await sock.sendMessage(from, { text: 'Group picture updated.' });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not update the group picture.' });
      }
    },
  },
  {
    name: 'poll',
    description: 'Group mein poll banata hai: .poll Sawaal | Option1 | Option2',
    execute: async ({ sock, from, args }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const parts = args.join(' ').split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) return sock.sendMessage(from, { text: 'Format: .poll Sawaal | Option1 | Option2 | ...' });
      const [question, ...options] = parts;
      try {
        await sock.sendMessage(from, {
          poll: { name: question, values: options, selectableCount: 1 },
        });
      } catch {
        await sock.sendMessage(from, { text: '❌ Poll banane mein error aaya.' });
      }
    },
  },
  {
    name: 'newgc',
    description: 'Naya group banata hai: .newgc Group Naam | 923xx,923yy (owner only)',
    execute: async ({ sock, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }
      const [name, numbersStr] = args.join(' ').split('|');
      if (!name || !numbersStr) return sock.sendMessage(from, { text: 'Format: .newgc Group Naam | 923001234567,923001234568' });
      const participants = numbersStr.split(',').map((n) => `${n.trim().replace(/[^0-9]/g, '')}@s.whatsapp.net`);
      try {
        const group = await sock.groupCreate(name.trim(), participants);
        await sock.sendMessage(from, { text: `Group "${name.trim()}" created.` });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not create the group.' });
      }
    },
  },
  {
    name: 'join',
    description: 'Invite link se group join karta hai (owner only): .join <link>',
    execute: async ({ sock, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }
      const link = args[0];
      if (!link) return sock.sendMessage(from, { text: 'Format: .join <invite link>' });
      const code = link.split('/').pop();
      try {
        await sock.groupAcceptInvite(code);
        await sock.sendMessage(from, { text: 'Joined the group.' });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not join the group.' });
      }
    },
  },
  {
    name: 'requests',
    description: 'Group join requests ki list dikhata hai (admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      try {
        const list = await sock.groupRequestParticipantsList(from);
        if (!list.length) return sock.sendMessage(from, { text: 'No pending join requests.' });
        const text = list.map((p, i) => `${i + 1}. @${p.jid.split('@')[0]}`).join('\n');
        await sock.sendMessage(from, { text: `📋 *Pending requests:*\n${text}`, mentions: list.map((p) => p.jid) });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not fetch requests (requires an approval-mode group).' });
      }
    },
  },
  {
    name: 'rejectall',
    description: 'Sab pending join requests reject karta hai (admin only)',
    execute: async ({ sock, msg, from }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      const sender = msg.key.participant || msg.key.remoteJid;
      if (!(await isAdmin(sock, from, sender))) return sock.sendMessage(from, { text: 'Only group admins can use this command.' });
      try {
        const list = await sock.groupRequestParticipantsList(from);
        if (!list.length) return sock.sendMessage(from, { text: 'No pending requests.' });
        await sock.groupRequestParticipantsUpdate(from, list.map((p) => p.jid), 'reject');
        await sock.sendMessage(from, { text: `${list.length} requests rejected.` });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not reject.' });
      }
    },
  },
  {
    name: 'dismissall',
    description: 'Group ke saare non-admin members ko ek sath remove karta hai (owner only, sambhal kar)',
    execute: async ({ sock, from, isInstanceOwner }) => {
      if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command only works in groups.' });
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }
      try {
        const metadata = await sock.groupMetadata(from);
        const nonAdmins = metadata.participants.filter((p) => !p.admin).map((p) => p.id);
        if (!nonAdmins.length) return sock.sendMessage(from, { text: 'No non-admin members.' });
        await sock.groupParticipantsUpdate(from, nonAdmins, 'remove');
        await sock.sendMessage(from, { text: `${nonAdmins.length} members removed.` });
      } catch {
        await sock.sendMessage(from, { text: '❌ Could not remove everyone.' });
      }
    },
  },
  {
    name: 'broadcast',
    description: 'Bot jin groups mein hai un sab ko ek message bhejta hai (owner only)',
    execute: async ({ sock, from, args, isInstanceOwner }) => {
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }
      const text = args.join(' ');
      if (!text) return sock.sendMessage(from, { text: 'Format: .broadcast <message>' });
      try {
        const allGroups = await sock.groupFetchAllParticipating();
        const ids = Object.keys(allGroups);
        let sent = 0;
        for (const gid of ids) {
          try {
            await sock.sendMessage(gid, { text: `📢 *Broadcast*\n\n${text}` });
            sent += 1;
          } catch {}
        }
        await sock.sendMessage(from, { text: `Broadcast sent to ${sent}/${ids.length} groups.` });
      } catch {
        await sock.sendMessage(from, { text: '❌ Broadcast failed.' });
      }
    },
  },
  {
    name: 'fun',
    description: 'Format: .fun,x,message — message ko x baar is chat mein bhejta hai (sirf bot owner, max 100)',
    execute: async ({ sock, from, rawText, isInstanceOwner }) => {
      // Sirf is bot instance ka apna owner — kisi bhi chat type mein, group-admin
      // hona zaroori nahi. Ye zaroori hai kyunki ek hi group mein alag logon ke
      // alag bot-instances ho sakte hain — sirf apna hi bot react kare, doosron ka nahi.
      if (!isInstanceOwner) {
        return sock.sendMessage(from, { text: "Only this bot's owner can use this command." });
      }

      const match = rawText.match(/^,\s*(\d+)\s*,\s*([\s\S]+)$/);
      if (!match) {
        return sock.sendMessage(from, { text: 'Format: .fun,x,message\ne.g. .fun,5,Hello everyone!' });
      }

      let count = parseInt(match[1], 10);
      const text = match[2];
      // WhatsApp khud hi account ko LOGOUT kar deta hai agar wahi message bohot
      // tezi se baar baar bheja jaye (spam-pattern detection) — isliye delay aur
      // cap dono conservative rakhe hain. Isay aur tez karna account-logout ka
      // real risk hai, sirf "slow" nahi.
      const MAX_REPEATS = 30;
      if (count > MAX_REPEATS) {
        await sock.sendMessage(from, { text: `⚠️ Max is ${MAX_REPEATS} (zyada tez/zyada baar bhejne se WhatsApp account ko logout kar deta hai) — sending ${MAX_REPEATS} instead.` });
        count = MAX_REPEATS;
      }

      for (let i = 0; i < count; i++) {
        try {
          await sock.sendMessage(from, { text });
        } catch (err) {
          console.error('fun command send error:', err.message);
          await sock.sendMessage(from, { text: '⚠️ Stopped — connection ya send error aaya (WhatsApp ne rok diya ho sakta hai).' }).catch(() => {});
          break;
        }
        await sleep(2500); // WhatsApp ke spam-detection se bachne ke liye zaroori delay
      }
    },
  },
];
