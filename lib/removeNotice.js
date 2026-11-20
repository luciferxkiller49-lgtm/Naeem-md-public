// Member ko group se nikalna + (sirf nikalne par) EK message ke zariye wajah batana.
// Delete par koi message nahi jata — sirf remove hone par, taake user ko pata chale ke kyun nikala gaya.
// Spam karne wale ke queue mein pade baqi messages par dobara kick/message nahi hota (2 minute ka dedupe).
const { tinyBold } = require('./font');
const recent = new Map(); // "group:sender" -> time
const TTL = 2 * 60 * 1000;

const userOf = (j) => String(j || '').split('@')[0].split(':')[0];

// Group members LID (@lid) ya phone number (PN) dono form mein aate hain. Dono candidates try karte hain.
function targetOf(msg, fallback) {
  const alt = msg?.key?.participantAlt;
  const out = [];
  if (alt && alt.endsWith('@s.whatsapp.net')) out.push(alt);
  if (msg?.key?.participant) out.push(msg.key.participant);
  if (fallback) out.push(fallback);
  return [...new Set(out)];
}

function alreadyRemoved(from, sender) {
  const t = recent.get(`${from}:${userOf(sender)}`);
  return !!t && Date.now() - t < TTL;
}

async function removeAndNotify(sock, from, target, reason) {
  const cands = [...new Set((Array.isArray(target) ? target : [target]).filter(Boolean))];
  const primary = cands[0];
  if (!primary || alreadyRemoved(from, primary)) return false;
  let ok = false; let lastSt = ''; let done = primary;
  for (const jid of cands) {
    try {
      const res = await sock.groupParticipantsUpdate(from, [jid], 'remove');
      lastSt = String(res?.[0]?.status ?? '200');
      if (lastSt.startsWith('2')) { ok = true; done = jid; break; }
    } catch (e) {
      lastSt = e.message || 'error';
    }
  }
  if (!ok) {
    console.error(`[KICK] ${userOf(primary)} ko group ${from.split('@')[0]} se nahi nikal saka (${cands.length} forms try): status ${lastSt} (target admin ho sakta hai ya bot admin nahi)`);
    return false;
  }
  const sender = done;
  recent.set(`${from}:${userOf(primary)}`, Date.now());
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
