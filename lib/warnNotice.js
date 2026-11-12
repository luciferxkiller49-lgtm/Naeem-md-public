// Warning message: "⚠️ @user, <wajah>". Har delete par bhejte to 100 links = 100 warnings (load), is liye
// ek user ko ek bot se WARN_COOLDOWN_SEC (default 20 second) mein sirf ek warning jati hai. 0 = har baar.
const userOf = (jid) => String(jid || '').split('@')[0].split(':')[0];
const COOLDOWN_MS = Math.max(0, parseFloat(process.env.WARN_COOLDOWN_SEC ?? '20')) * 1000;
const last = new Map();

async function warn(sock, from, sender, text) {
  const key = `${userOf(sock.user?.id)}:${from}:${userOf(sender)}`;
  const now = Date.now();
  if (COOLDOWN_MS > 0 && now - (last.get(key) || 0) < COOLDOWN_MS) return false;
  last.set(key, now);
  if (last.size > 2000) for (const [k, t] of last) if (now - t > 600000) last.delete(k);
  try {
    await sock.sendMessage(from, { text: `⚠️ @${userOf(sender)}, ${text}`, mentions: [sender] });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { warn, userOf };
