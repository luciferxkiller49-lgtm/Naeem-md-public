// Multi-key API pool: ek key fail ho to agli key (1 -> 2 -> 3 ...). Har request key 1 se shuru hoti hai.
// Ek key 3 BAAR LAGATAR fail ho to owner ko WhatsApp par reminder jata hai, aur wo key 10 minute ke liye chhod di jati hai.
// Keys Config Vars se, naam ke prefix ke saath:
//   SERVERAPI  -> SERVERAPI_KEYS=k1,k2  ya  SERVERAPI_KEY_1 ... SERVERAPI_KEY_10
//   FASTSAVER  -> FASTSAVER_API_KEY=k1  ya  FASTSAVER_API_KEYS=k1,k2  ya  FASTSAVER_API_KEY_1 ... FASTSAVER_API_KEY_10
// Key ka poora text kisi log ya message mein nahi jata (sirf pehle/aakhri 3 characters).
const FAIL_LIMIT = Math.max(1, parseInt(process.env.APIPOOL_FAIL_LIMIT || process.env.SERVERAPI_FAIL_LIMIT || '3', 10));
const COOLDOWN_MS = Math.max(60000, parseInt(process.env.APIPOOL_COOLDOWN_MS || process.env.SERVERAPI_COOLDOWN_MS || String(10 * 60 * 1000), 10));
const ALERT_EVERY_MS = 60 * 60 * 1000;

const state = new Map(); // "NAME|key" -> { fails, cooldownUntil, lastAlert }
let notifier = null;

function loadKeys(name = 'SERVERAPI') {
  const env = (k) => process.env[k];
  const list = [];
  for (const k of [`${name}_KEYS`, `${name}_API_KEYS`]) {
    if (env(k)) list.push(...env(k).split(/[\s,]+/));
  }
  if (env(`${name}_API_KEY`)) list.push(env(`${name}_API_KEY`));
  for (let i = 1; i <= 10; i++) {
    if (env(`${name}_API_KEY_${i}`)) list.push(env(`${name}_API_KEY_${i}`));
    if (env(`${name}_KEY_${i}`)) list.push(env(`${name}_KEY_${i}`));
  }
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

const mask = (k) => (k.length <= 8 ? '***' : `${k.slice(0, 3)}…${k.slice(-3)}`);
function setNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }
function keyCount(name = 'SERVERAPI') { return loadKeys(name).length; }

async function alertOwner(name, idx, key, label, reason, st) {
  const now = Date.now();
  if (now - st.lastAlert < ALERT_EVERY_MS) return;
  st.lastAlert = now;
  const text =
    `⚠️ *${name} key #${idx + 1}* (${mask(key)}) ${FAIL_LIMIT} baar lagataar fail hui.\n` +
    `Kaam: ${label}\nWajah: ${reason}\n\n` +
    `Check karein: key sahi hai ya nahi, quota khatam to nahi, ya naya key Config Vars mein dalein. ` +
    `Ye key ${Math.round(COOLDOWN_MS / 60000)} minute ke liye chhod di gayi hai, agli keys istemal ho rahi hain.`;
  console.error(`[APIPOOL] ${name} key#${idx + 1} ${FAIL_LIMIT} lagatar fail: ${reason}`);
  try { if (notifier) await notifier(text); } catch (e) { /* alert fail ho to bhi API chalti rahe */ }
}

/**
 * makeRequest(key) chalta hai. Throw ho to agli key. Pehli kamyab key ka result return hota hai.
 */
async function call(makeRequest, { label = 'api', name = 'SERVERAPI' } = {}) {
  const keys = loadKeys(name);
  if (!keys.length) throw new Error(`${name} keys set nahi hain`);
  const errors = [];
  for (let idx = 0; idx < keys.length; idx++) {
    const key = keys[idx];
    const sk = `${name}|${key}`;
    const st = state.get(sk) || { fails: 0, cooldownUntil: 0, lastAlert: 0 };
    state.set(sk, st);
    if (st.cooldownUntil > Date.now()) { errors.push(`key#${idx + 1} cooldown`); continue; }
    try {
      const res = await makeRequest(key);
      st.fails = 0;
      return res;
    } catch (e) {
      // Video ka masla (key ka nahi): key ko fail count na karein, agli key bhi nahi
      if (e && e.contentError) throw e;
      st.fails++;
      const reason = String(e?.message || e);
      errors.push(`key#${idx + 1}: ${reason}`);
      if (st.fails >= FAIL_LIMIT) {
        st.cooldownUntil = Date.now() + COOLDOWN_MS;
        st.fails = 0;
        await alertOwner(name, idx, key, label, reason, st);
      }
    }
  }
  throw new Error(`Sab ${name} keys fail: ${errors.join(' | ')}`);
}

module.exports = { call, setNotifier, keyCount, loadKeys, mask, FAIL_LIMIT, COOLDOWN_MS };
