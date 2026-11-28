// Group status (story) post karne ka helper. gcstatus aur fuck dono isi ko istemal karte hain.
const crypto = require('crypto');
const { generateWAMessageContent, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const gcTrace = require('./gcTrace');

// Sirf text wale status ka background/font (bina iske kuch clients par text status theek nahi dikhta)
const TEXT_BG = process.env.GCSTATUS_BG || '#128C7E';

/**
 * Status ka content ek hi baar banao (media sirf ek baar upload hota hai).
 * Pehle har group ke liye dobara upload hota tha — .gcstatus all par 100 groups = 100 uploads, jo slow tha aur fail ka sabab banta tha.
 */
async function prepareGroupStatus(sock, payload) {
  const opts = { upload: sock.waUploadToServer, logger: console };
  if (payload && payload.text && !payload.image && !payload.video) {
    opts.backgroundColor = TEXT_BG;
    opts.font = 2;
  }
  return generateWAMessageContent(payload, opts);
}

/** Taiyar content ek group mein bhejo. Har group ka apna messageSecret. Server ka jawab nahi dekhta (neeche collector dekhta hai). */
async function sendPreparedGroupStatus(sock, groupJid, content) {
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
  // Bot ka apna post .delstory ki list mein bhi aata hai
  try {
    const me = sock.user?.id;
    require('./bulkCache').record(groupJid, {
      key: { remoteJid: groupJid, id: full.key.id, fromMe: true, participant: me },
      message: full.message,
    });
  } catch (e) { /* record fail ho to post pe asar na ho */ }
  return full.key.id;
}

/**
 * Pehle "✅ posted" tab likha jata tha jab message sirf relay ho jaye — server ne reject kiya ya nahi, ye nahi dekha jata tha.
 * Ye collector WhatsApp ke "ack error" (messages.update, status ERROR) sunta hai taake asli wajah (error code) mil sake.
 * Note: server khamoshi se bhi gira sakta hai; error ack na aaye to hum "koi error nahi aaya" hi keh sakte hain, "pakka lag gaya" nahi.
 */
function createAckCollector(sock) {
  const errors = new Map(); // messageId -> error code/text
  const onUpdate = (updates) => {
    for (const u of updates || []) {
      const id = u?.key?.id;
      if (!id) continue;
      const st = u.update?.status;
      const params = u.update?.messageStubParameters;
      if (st === 0 || (Array.isArray(params) && params.length)) errors.set(id, String(params?.[0] ?? 'server error'));
    }
  };
  sock.ev.on('messages.update', onUpdate);
  return {
    errorFor: (id) => errors.get(id) || null,
    stop: () => { try { (sock.ev.off || sock.ev.removeListener).call(sock.ev, 'messages.update', onUpdate); } catch (e) {} },
  };
}

// Purana simple interface (fuck.js istemal karta hai): ek group, id wapas
async function postGroupStatus(sock, groupJid, payload) {
  const content = await prepareGroupStatus(sock, payload);
  const id = await sendPreparedGroupStatus(sock, groupJid, content);
  gcTrace.add({ kind: 'post', group: groupJid, result: 'bheja', id });
  return id;
}

module.exports = { postGroupStatus, prepareGroupStatus, sendPreparedGroupStatus, createAckCollector };
