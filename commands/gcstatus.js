// .gcstatus — Group Status (group story) post karna.
// Official Baileys mein "groupStatusMessage" naam ka shortcut nahi hai (wo sirf kuch third-party forks mein hota hai),
// isi liye purana command fail hota tha. Yahan message khud banakar relay kiya jata hai.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { tinyBold } = require('../lib/font');
const { prepareGroupStatus, sendPreparedGroupStatus, createAckCollector } = require('../lib/groupStatus');
const gcTrace = require('../lib/gcTrace');

const say = (sock, jid, text) => sock.sendMessage(jid, { text: tinyBold(text) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// .gcstatus all: har group ke beech ka gap (WhatsApp ke rate limit se bachne ke liye) aur aakhir mein server ka jawab sunne ka waqt
const GAP_MS = Math.max(1500, parseInt(process.env.GCSTATUS_GAP_MS || '3000', 10));
const ACK_WAIT_MS = 7000;

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

      // Media/text ka content EK hi baar (pehle har group ke liye dobara upload hota tha)
      let content;
      try { content = await prepareGroupStatus(sock, payload); }
      catch (err) { return say(sock, from, `❌ Status taiyar nahi ho saka: ${err.message}`); }

      let groupIds;
      const names = new Map();
      if (all) {
        try {
          const groups = await sock.groupFetchAllParticipating();
          groupIds = Object.keys(groups);
          for (const g of Object.values(groups)) names.set(g.id, g.subject);
        } catch (err) { return say(sock, from, '❌ Could not fetch your groups list.'); }
        await say(sock, from, `⏳ Posting group status in ${groupIds.length} groups...`);
      } else {
        groupIds = [from];
      }

      const acks = createAckCollector(sock);
      const sent = []; // { gid, id }
      const failed = []; // { gid, why }
      try {
        for (const gid of groupIds) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const id = await sendPreparedGroupStatus(sock, gid, content);
              sent.push({ gid, id });
              break;
            } catch (err) {
              const m = String(err?.message || err);
              if (/rate-overlimit/i.test(m) && attempt === 1) { await sleep(8000); continue; }
              console.error(`[GCSTATUS] failed for ${gid}:`, m);
              failed.push({ gid, why: m });
              gcTrace.add({ kind: 'post', group: gid, result: `fail: ${m}` });
              break;
            }
          }
          if (all) await sleep(GAP_MS);
        }
        // Server ke "error ack" ka intezar: relay ho jana = server ne qabool kar liya, ye zaroori nahi
        if (sent.length) await sleep(ACK_WAIT_MS);
      } finally {
        acks.stop();
      }

      let okCount = 0;
      for (const s of sent) {
        const e = acks.errorFor(s.id);
        if (e) {
          failed.push({ gid: s.gid, why: `server ne reject kiya (code ${e})` });
          gcTrace.add({ kind: 'post', group: s.gid, result: `server reject: ${e}`, id: s.id });
        } else {
          okCount += 1;
          gcTrace.add({ kind: 'post', group: s.gid, result: 'bheja, server se error nahi aaya', id: s.id });
        }
      }

      let text = okCount
        ? `✅ Group status ${okCount}/${groupIds.length} group${groupIds.length > 1 ? 's' : ''} mein bheja gaya (server se koi error nahi aaya).`
        : '❌ Group status kisi group mein nahi ja saka.';
      if (okCount) text += '\n\nℹ️ Agar kisi group mein dikhe nahi to us group mein .gcdiag chala kar dekhein.';
      // Header stylish font mein, lekin fail ki list (group ke naam) asli shakal mein taake parhi ja sake
      let rawTail = '';
      if (failed.length) {
        const label = (gid) => names.get(gid) || gid.split('@')[0];
        const lines = failed.slice(0, 12).map((f) => `• ${label(f.gid)} — ${f.why}`);
        rawTail = `\n\n❌ Fail (${failed.length}):\n${lines.join('\n')}${failed.length > 12 ? `\n… aur ${failed.length - 12}` : ''}`;
      }
      await sock.sendMessage(from, { text: tinyBold(text) + rawTail });
    },
  },
];
