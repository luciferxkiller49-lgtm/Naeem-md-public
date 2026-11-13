// Multi-key API pool: ek key fail ho to agli key try hoti hai (1, phir 2, phir 3 ...).
// Ek key 3 BAAR LAGATAR fail ho to owner ko reminder jata hai aur wo key 10 minute ke liye chhod di jati hai.
// Har request key 1 se shuru hoti hai (1 -> 2 -> 3 ...).
// Keys Config Vars se: SERVERAPI_KEYS=key1,key2,key3 (ya SERVERAPI_KEY_1 ... SERVERAPI_KEY_10).
// Key ko poora kisi log ya message mein nahi dikhaya jata.
const FAIL_LIMIT = Math.max(1, parseInt(process.env.SERVERAPI_FAIL_LIMIT || '3', 10));
const COOLDOWN_MS = Math.max(60000, parseInt(process.env.SERVERAPI_COOLDOWN_MS || String(10 * 60 * 1000), 10));
const ALERT_EVERY_MS = 60 * 60 * 1000;

const state = new Map(); // key -> { fails, cooldownUntil, lastAlert }
let notifier = null;

function loadKeys() {
  const list = [];
  if (process.env.SERVERAPI_KEYS) list.push(...process.env.SERVERAPI_KEYS.split(/[\s,]+/));
  for (let i = 1; i <= 10; i++) if (process.env[`SERVERAPI_KEY_${i}`]) list.push(process.env[`SERVERAPI_KEY_${i}`]);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

const mask = (k) => (k.length <= 8 ? '***' : `${k.slice(0, 3)}…${k.slice(-3)}`);
function setNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }
function keyCount() { return loadKeys().length; }

async function alertOwner(idx, key, label, reason, st) {
  const now = Date.now();
  if (now - st.lastAlert < ALERT_EVERY_MS) return;
  st.lastAlert = now;
  const text =
    `⚠️ *API key #${idx + 1}* (${mask(key)}) ${FAIL_LIMIT} baar lagataar fail hui.\n` +
    `Kaam: ${label}\nWajah: ${reason}\n\n` +
    `Check karein: key sahi hai ya nahi, quota khatam to nahi, ya naya key Config Vars (SERVERAPI_KEYS) mein dalein. ` +
    `Ye key ${Math.round(COOLDOWN_MS / 60000)} minute ke liye chhod di gayi hai, agli keys istemal ho rahi hain.`;
  console.error(`[APIPOOL] key#${idx + 1} ${FAIL_LIMIT} lagatar fail: ${reason}`);
  try { if (notifier) await notifier(text); } catch (e) { /* alert fail ho to bhi API chalti rahe */ }
}

/**
 * makeRequest(key) ko chalata hai. Throw ho to agli key. Pehli kamyab key ka result return hota hai.
 */
async function call(makeRequest, { label = 'api' } = {}) {
  const keys = loadKeys();
  if (!keys.length) throw new Error('SERVERAPI_KEYS set nahi hain (Config Vars mein SERVERAPI_KEYS=key1,key2 bharein)');
  const now = Date.now();
  const errors = [];
  for (let step = 0; step < keys.length; step++) {
    const idx = step; // har request key 1 se shuru (1, phir 2, phir 3 ...), taake har key ke fail count sahi chalein
    const key = keys[idx];
    const st = state.get(key) || { fails: 0, cooldownUntil: 0, lastAlert: 0 };
    state.set(key, st);
    if (st.cooldownUntil > now) { errors.push(`key#${idx + 1} cooldown`); continue; }
    try {
      const res = await makeRequest(key);
      st.fails = 0;
      return res;
    } catch (e) {
      st.fails++;
      const reason = String(e?.message || e);
      errors.push(`key#${idx + 1}: ${reason}`);
      if (st.fails >= FAIL_LIMIT) {
        st.cooldownUntil = Date.now() + COOLDOWN_MS;
        st.fails = 0;
        await alertOwner(idx, key, label, reason, st);
      }
    }
  }
  throw new Error(`Sab API keys fail: ${errors.join(' | ')}`);
}

module.exports = { call, setNotifier, keyCount, loadKeys, mask, FAIL_LIMIT, COOLDOWN_MS };
