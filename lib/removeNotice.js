// Member ko group se nikalna + (sirf nikalne par) EK message ke zariye wajah batana.
// Delete par koi message nahi jata — sirf remove hone par, taake user ko pata chale ke kyun nikala gaya.
// Spam karne wale ke queue mein pade baqi messages par dobara kick/message nahi hota (2 minute ka dedupe).
const { tinyBold } = require('./font');
const recent = new Map(); // "group:sender" -> time
const TTL = 2 * 60 * 1000;

function alreadyRemoved(from, sender) {
  const t = recent.get(`${from}:${sender}`);
  return !!t && Date.now() - t < TTL;
}

async function removeAndNotify(sock, from, sender, reason) {
  if (alreadyRemoved(from, sender)) return false;
  let ok = true;
  try {
    const res = await sock.groupParticipantsUpdate(from, [sender], 'remove');
    const st = String(res?.[0]?.status || '200');
    ok = st.startsWith('2'); // 403 = admin/owner, nikal nahi sakte
  } catch (e) {
    ok = false;
  }
  if (!ok) return false;

  recent.set(`${from}:${sender}`, Date.now());
  if (recent.size > 500) for (const [k, t] of recent) if (Date.now() - t > TTL) recent.delete(k);

  try {
    // FIX: pehle bilkul plain text tha, ab baaki bot jaisa hi font-style.
    await sock.sendMessage(from, {
      text: `🚫 @${sender.split('@')[0].split(':')[0]}\n${tinyBold(`removed — ${reason}`)}`,
      mentions: [sender],
    });
  } catch (e) {}
  return true;
}
