// Ye saare commands sirf MAZAAK/PRANK ke liye hain — koi asal hacking nahi hoti.
// Original "hack menu" wale bots mein bhi ye hamesha fake simulation hoti hai,
// koi real account access nahi milta. Hum bhi yahi tareeqa follow kar rahe hain.

function fakeProgress(target) {
  return (
    `🔓 *Hack Simulation* (for fun only)\n\n` +
    `Target: ${target || 'unknown'}\n` +
    `[■■■■■■■■■■] 100%\n\n` +
    `😅 Just kidding — this is a joke command, no real hacking happens. ` +
    `Real account hacking is illegal and not something this bot does.`
  );
}

function prankCommand(name, aliases) {
  return {
    name,
    aliases,
    description: `${name} — sirf mazaak ke liye (koi asal hacking nahi)`,
    execute: async ({ sock, from, args, msg }) => {
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = mentioned ? `@${mentioned.split('@')[0]}` : args.join(' ') || 'unknown';
      await sock.sendMessage(from, { text: fakeProgress(target), mentions: mentioned ? [mentioned] : [] });
    },
  };
}

module.exports = [
  prankCommand('hack'),
  prankCommand('mobilehack'),
  prankCommand('ighack'),
  prankCommand('fbhack'),
  prankCommand('fbihack'),
  prankCommand('snaphack'),
  {
    name: 'hackmenu',
    description: 'Hack-style prank commands ki list',
    execute: async ({ sock, from, config }) => {
      const p = config.prefix;
      await sock.sendMessage(from, {
        text:
          `🔓 *Hack Menu* (fun/prank only — no real hacking)\n\n` +
          `${p}hack, ${p}mobilehack, ${p}ighack, ${p}fbhack, ${p}fbihack, ${p}snaphack\n\n` +
          `Ye sab sirf entertainment ke liye hain.`,
      });
    },
  },
];
