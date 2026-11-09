/**
 * Group ke andar bheje gaye "link wale" aur "group-status" messages ke
 * keys yaad rakhta hai — taake .delalllink / .delallstatus unhe ek sath
 * delete kar sakein, chahe antilink/antigcstatus us waqt ON ho ya na ho.
 *
 * Sirf RAM mein (Mongo mein nahi) — restart hone par list khali ho jati
 * hai, jo theek hai: ye sirf "abhi tak jo dekha" ka temporary record hai,
 * koi zaroori data nahi. Har group ke liye list ek hadd (MAX_PER_GROUP) se
 * zyada badi nahi hone dete, warna bohot active groups mein memory barh
 * sakti hai.
 */
const WHATSAPP_LINK_REGEX = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;
const ALL_LINK_REGEX = /(https?:\/\/[^\s]+)/i;
const GCSTATUS_KEYS = ['groupStatusMessageV2', 'groupStatusMessage'];

const MAX_PER_GROUP = 1000;

const linkKeys = new Map();   // groupId -> [key, key, ...]
const statusKeys = new Map(); // groupId -> [key, key, ...]

function push(map, groupId, key) {
  let arr = map.get(groupId);
  if (!arr) { arr = []; map.set(groupId, arr); }
  arr.push(key);
  if (arr.length > MAX_PER_GROUP) arr.splice(0, arr.length - MAX_PER_GROUP);
}

function take(map, groupId) {
  const arr = map.get(groupId) || [];
  map.delete(groupId);
  return arr;
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

/** Group ke har aane wale message par call karein (sirf isGroup === true ke liye) */
function record(groupId, msg) {
  if (!msg?.message || !msg.key) return;
  const m = unwrap(msg.message);

  if (GCSTATUS_KEYS.some((k) => k in m)) {
    push(statusKeys, groupId, msg.key);
    return; // status message mein link ki checking ki zaroorat nahi
  }

  const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
  if (text && (WHATSAPP_LINK_REGEX.test(text) || ALL_LINK_REGEX.test(text))) {
    push(linkKeys, groupId, msg.key);
  }
}

const takeLinkKeys = (groupId) => take(linkKeys, groupId);
const takeStatusKeys = (groupId) => take(statusKeys, groupId);

module.exports = { record, takeLinkKeys, takeStatusKeys };
