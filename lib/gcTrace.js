// Group-status (story) ka "kya hua" record: har event ke liye ek chhoti entry (sirf RAM, 60 tak).
// .gcdiag isi ko dikhata hai — taake pata chale bot ne status dekha ya nahi, kis raaste se aaya, aur delete/warn kyun nahi hua.
const MAX = 60;
const entries = [];

function add(e) {
  entries.push({ t: Date.now(), ...e });
  if (entries.length > MAX) entries.shift();
}

function last(n = 8, group) {
  const list = group ? entries.filter((e) => e.group === group) : entries;
  return list.slice(-n);
}

// Message ke andar ki keys ka chhota naqsha (kya structure aaya), depth 3 tak — diagnostic ke liye
function shape(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return typeof obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) { out[k] = 'bytes'; continue; }
    out[k] = typeof v === 'object' ? shape(v, depth + 1) : typeof v === 'string' && /@(g\.us|s\.whatsapp\.net|lid)$/.test(v) ? v : typeof v;
  }
  return out;
}

module.exports = { add, last, shape };

// status@broadcast par aaye group status mein se group ka JID dhoondna (message ke andar kahin @g.us wali field)
function groupJidFromStatus(msg) {
  const seen = new Set();
  const find = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return null;
    seen.add(o);
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /@g\.us$/.test(v) && /(group|parent|remote|chat)/i.test(k)) return v;
    }
    for (const v of Object.values(o)) {
      const r = find(v, d + 1);
      if (r) return r;
    }
    return null;
  };
  const alt = msg?.key?.remoteJidAlt;
  return find(msg?.message) || (typeof alt === 'string' && alt.endsWith('@g.us') ? alt : null);
}

// Group status wali top-level key (mention wali nahi). Naam badal jaye (V2/V3...) to bhi pakad le.
function gcStatusKeys(m) {
  return Object.keys(m || {}).filter((k) => !!m[k] && /groupstatus/i.test(k) && !/mention/i.test(k));
}

module.exports.groupJidFromStatus = groupJidFromStatus;
module.exports.gcStatusKeys = gcStatusKeys;
