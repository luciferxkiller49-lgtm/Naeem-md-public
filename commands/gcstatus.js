// .gcstatus — Group Status (group story) post karna.
// Official Baileys mein "groupStatusMessage" naam ka shortcut nahi hai (wo sirf kuch third-party forks mein hota hai),
// isi liye purana command fail hota tha. Yahan message khud banakar relay kiya jata hai.
const crypto = require('crypto');
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const { tinyBold } = require('../lib/font');

const say = (sock, jid, text) => sock.sendMessage(jid, { text: tinyBold(text) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postGroupStatus(sock, groupJid, payload) {
  const content = await generateWAMessageContent(payload, {
    upload: sock.waUploadToServer,
    logger: console,
  });
  const secret = crypto.randomBytes(32);
  const full = generateWAMessageFromContent(
    groupJid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: { message: { ...content, messageContextInfo: { messageSecret: secret } } },
    },
    { userJid: sock.user.id }
  );
  await sock.relayMessage(groupJid, full.message, { messageId: full.key.id });
  return full.key.id;
}

module.exports = [
  {
    name: 'gcstatus',
    aliases: ['groupstatus'],
    description: 'Post a group status (story): this group, or `all` for every group (owner only)',
    category: 'group',
    async execute(ctx) {
      const { sock, msg, from, args, prefix, isInstanceOwner } = ctx;
      if (!isInstanceOwner) return say(sock, from, '❌ Only the bot owner can use this command.');

      const all = (args[0] || '').toLowerCase() === 'all';
      const textArgs = all ? args.slice(1) : args;

      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const target = quoted || msg.message || {};
      const isImage = !!target.imageMessage;
      const isVideo = !!target.videoMessage;
      const caption = target.imageMessage?.caption || target.videoMessage?.caption || textArgs.join(' ');

      if (!isImage && !isVideo && !caption) {
        return say(sock, from,
          `Reply to an image or video, or write some text.\n\n• ${prefix}gcstatus <text> — post in this group\n• ${prefix}gcstatus all <text> — post in every group\n• reply to an image/video with ${prefix}gcstatus`);
      }
      if (!all && !from.endsWith('@g.us')) {
        return say(sock, from, `❌ Use this inside a group, or use ${prefix}gcstatus all to post in every group.`);
      }

      let payload;
      try {
        if (isImage || isVideo) {
          const buffer = await downloadMediaMessage(
            { key: msg.key, message: target }, 'buffer', {},
            { logger: console, reuploadRequest: sock.updateMediaMessage }
          );
          payload = isImage ? { image: buffer, caption: caption || undefined } : { video: buffer, caption: caption || undefined };
        } else {
          payload = { text: caption };
        }
      } catch (err) {
        return say(sock, from, `❌ Could not read the media: ${err.message}`);
      }

      let groupIds;
      if (all) {
        try { groupIds = Object.keys(await sock.groupFetchAllParticipating()); }
        catch (err) { return say(sock, from, '❌ Could not fetch your groups list.'); }
        await say(sock, from, `⏳ Posting group status in ${groupIds.length} groups...`);
      } else {
        groupIds = [from];
      }

      let ok = 0;
      const errors = new Map();
      for (const gid of groupIds) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await postGroupStatus(sock, gid, payload);
            ok += 1;
            break;
          } catch (err) {
            const m = String(err?.message || err);
            if (/rate-overlimit/i.test(m) && attempt === 1) { await sleep(8000); continue; }
            console.error(`[GCSTATUS] failed for ${gid}:`, m);
            errors.set(m, (errors.get(m) || 0) + 1);
            break;
          }
        }
        if (all) await sleep(3000);
      }

      let text = ok
        ? `✅ Group status posted in ${ok}/${groupIds.length} group${groupIds.length > 1 ? 's' : ''}.`
        : '❌ Group status could not be posted.';
      if (errors.size) text += `\n\n❌ Failed: ${[...errors.entries()].map(([m, n]) => `${m} (${n})`).join(', ')}`;
      await say(sock, from, text);
    },
  },
];
