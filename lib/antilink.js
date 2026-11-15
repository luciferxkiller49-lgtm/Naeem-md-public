const store = require('./store');
const { removeAndNotify, targetOf } = require('./removeNotice');
const deleteGuard = require('./deleteGuard');
const { warn, userOf } = require('./warnNotice');
const { MARKER } = require('./signature');

// Bot ke apne jawab (menu, channel link, group link waghera) par hamesha signature hota hai. Doosre bots ke antilink unhe delete na karein.
// EXEMPT_BOT_SIGNATURE=off se band (koi spammer signature copy kar le to is se bachne ke liye)
const EXEMPT_SIG = String(process.env.EXEMPT_BOT_SIGNATURE || 'on').toLowerCase() !== 'off';

const WHATSAPP_LINK_REGEX = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;
const ALL_LINK_REGEX = /(https?:\/\/[^\s]+)/i; // 'g' flag nahi: .test() ke saath wo agle message par galat jagah se dhoondhta hai

const warnings = new Map();

/**
 * Handle Antilink moderation for incoming message
 */
async function handleAntilink(sock, msg, from, sender, isGroup, isBotAdmin, isSenderAdmin) {
  if (!isGroup || isSenderAdmin) return false;      // group admin ka link kabhi delete nahi
  if (msg.key?.fromMe) return false;                 // bot ka apna (owner ka apna / bot ka apna jawab) kabhi delete nahi

  const groupSettings = await store.getGroupSettings(from);
  if (!groupSettings.antilink) return false;

  const text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption || 
               msg.message?.videoMessage?.caption || '';

  if (!text) return false;
  if (EXEMPT_SIG && text.includes(MARKER)) return false; // kisi bot ka signature wala jawab

  const hasLink = groupSettings.antilink === 'all' 
    ? ALL_LINK_REGEX.test(text) 
    : WHATSAPP_LINK_REGEX.test(text);

  if (!hasLink) return false;


  if (isBotAdmin) {
    try {
      // Ek hi server par is group mein kai bots hon to sirf pehla bot kaam karta hai (baqi ko wohi message milta hai)
      if (deleteGuard.has(msg.key.id)) return true; // doosre bot (isi process) ne pehle hi delete kar diya

      // 1. Delete message (kamyab hone par hi claim)
      await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: msg.key.participant || msg.key.participantAlt } });
      deleteGuard.mark(msg.key.id);

      // 2. Mode ke hisaab se action. Warning wapis hai (user ko pata chale kyun hata) lekin throttled (WARN_COOLDOWN_SEC).
      if (groupSettings.antilink === 'kick') {
        await removeAndNotify(sock, from, targetOf(msg, sender), 'group mein links bhejna mana hai'); // nikalne wala message hi wajah batata hai
      } else if (groupSettings.antilink === 'warn') {
        // warning ginti har bot ki apni (pehle sab bots ek hi ginti barhate the -> pehle hi link par kick)
        const userKey = `${userOf(sock.user?.id)}:${from}:${sender}`;
        const count = (warnings.get(userKey) || 0) + 1;
        if (count >= 3) {
          warnings.delete(userKey);
          await removeAndNotify(sock, from, targetOf(msg, sender), 'group mein baar baar links bhejna mana hai (3 warnings)');
        } else {
          warnings.set(userKey, count);
          await warn(sock, from, sender, `sending links is not allowed! (${count}/3)`);
        }
      } else {
        await warn(sock, from, sender, 'sending links is not allowed!');
      }
      return true;
    } catch (err) {
      console.error('[ANTILINK] Failed to moderate:', err.message);
    }
  }

  return false;
}

module.exports = {
  handleAntilink
};
