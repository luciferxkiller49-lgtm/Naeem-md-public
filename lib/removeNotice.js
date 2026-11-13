// Member ko group se nikalna + (sirf nikalne par) EK message ke zariye wajah batana.
// Delete par koi message nahi jata — sirf remove hone par, taake user ko pata chale ke kyun nikala gaya.
// Spam karne wale ke queue mein pade baqi messages par dobara kick/message nahi hota (2 minute ka dedupe).
const { tinyBold } = require('./font');
const recent = new Map(); // "group:sender" -> time
const TTL = 2 * 60 * 1000;

const userOf = (j) => String(j || '').split('@')[0].split(':')[0];

// Group members aksar LID (@lid) mein aate hain. Kick ke liye phone number wala JID (participantAlt) behtar hai.
function targetOf(msg, fallback) {
  const alt = msg?.key?.participantAlt;
  return alt && alt.endsWith('@s.whatsapp.net') ? alt : fallback;
}

function alreadyRemoved(from, sender) {
  const t = recent.get(`${from}:${userOf(sender)}`);
  return !!t && Date.now() - t < TTL;
}

async function removeAndNotify(sock, from, sender, reason) {
  if (alreadyRemoved(from, sender)) return false;
  let ok = false; let lastSt = '';
  // Ek koshish, status log hota hai (fail hone par wajah dikhe)
  for (const jid of [sender]) {
    try {
      const res = await sock.groupParticipantsUpdate(from, [jid], 'remove');
      lastSt = String(res?.[0]?.status ?? '200');
      if (lastSt.startsWith('2')) { ok = true; sender = jid; break; }
    } catch (e) {
      lastSt = e.message || 'error';
    }
  }
  if (!ok) {
    console.error(`[KICK] ${userOf(sender)} ko group ${from.split('@')[0]} se nahi nikal saka: status ${lastSt} (target admin ho sakta hai ya bot admin nahi)`);
    return false;
  }

  recent.set(`${from}:${userOf(sender)}`, Date.now());
  if (recent.size > 500) for (const [k, t] of recent) if (Date.now() - t > TTL) recent.delete(k);

  try {
    await sock.sendMessage(from, {
      text: `🚫 @${userOf(sender)}\n${tinyBold(`removed — ${reason}`)}`,
      mentions: [sender],
    });
  } catch (e) {}
  return true;
}

module.exports = { removeAndNotify, alreadyRemoved, targetOf };
