// Reconnect ke faislay (pure functions): kab dobara jodna hai, kab chhor dena hai, kitni der baad
const PAIRING_WINDOW_MS = 4 * 60 * 1000; // naye pairing ko code enter karne ke liye itna waqt
const RESTART_REQUIRED = 515; // pairing ke foran baad aata hai — reconnect zaroori
const CONNECTION_REPLACED = 440; // kisi aur jagah isi session se login ho gaya

/**
 * paired: kya number kabhi WhatsApp se link ho chuka hai
 * Jo number kabhi link hi nahi hua (galat number, ya code enter nahi hua) usay baar baar jodne ka koi faida nahi.
 */
function shouldGiveUp({ paired, statusCode, pairStartedAt, now = Date.now() }) {
  if (paired) return false;
  if (statusCode === RESTART_REQUIRED) return false;
  if (pairStartedAt && now - pairStartedAt < PAIRING_WINDOW_MS) return false;
  return true;
}

// 5s, 10s, 20s, 40s, 60s, 60s... (thora jitter). 440 par zyada intezaar.
function nextDelay(attempt, statusCode) {
  const base = statusCode === CONNECTION_REPLACED ? 30000 : 5000;
  const d = Math.min(base * 2 ** Math.max(0, attempt - 1), 60000);
  return d + Math.floor(Math.random() * 1000);
}

module.exports = { shouldGiveUp, nextDelay, PAIRING_WINDOW_MS };
