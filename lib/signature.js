// Har command ke jawab ke neeche bot ka signature (text aur caption dono par)
const SIGNATURE = '*𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘*      *NAEEM-MD*';
const MARKER = '𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘';
const SKIP_KEYS = ['react', 'delete', 'edit', 'forward', 'poll', 'sticker', 'audio', 'contacts', 'location', 'protocolMessage'];

function sign(content) {
  if (!content || typeof content !== 'object') return content;
  if (content.__noSign) { const { __noSign, ...rest } = content; return rest; }
  if (SKIP_KEYS.some((k) => k in content)) return content;
  for (const field of ['text', 'caption']) {
    const v = content[field];
    if (typeof v === 'string' && v.length && !v.includes(MARKER)) {
      return { ...content, [field]: `${v}\n\n${SIGNATURE}` };
    }
    if (typeof v === 'string') return content;
  }
  return content;
}

// sock jaisa hi object, bas sendMessage mein signature lag jata hai
function signedSock(sock) {
  return new Proxy(sock, {
    get(target, prop) {
      if (prop === 'sendMessage') return (jid, content, opts) => target.sendMessage(jid, sign(content), opts);
      return target[prop];
    },
  });
}

module.exports = { SIGNATURE, sign, signedSock };
