// Apna channel: menu/alive par "forwarded from channel" tag + channel link
const config = require('../config');
const cache = new Map();

function codeOf(url) {
  return (url || '').split('/channel/')[1]?.split(/[?/]/)[0] || null;
}

async function getMainChannel(sock) {
  const url = config.channelInvites[0];
  const code = codeOf(url);
  if (!code) return null;
  if (cache.has(code)) return cache.get(code);
  try {
    const meta = await sock.newsletterMetadata('invite', code);
    if (meta?.id) {
      const info = { jid: meta.id, name: meta.name || config.BOT_NAME, url };
      cache.set(code, info);
      return info;
    }
  } catch (e) {}
  return { jid: null, name: config.BOT_NAME, url };
}

async function channelContext(sock) {
  const ch = await getMainChannel(sock);
  if (!ch?.jid) return undefined;
  return {
    isForwarded: true,
    forwardingScore: 999,
    forwardedNewsletterMessageInfo: { newsletterJid: ch.jid, newsletterName: ch.name, serverMessageId: -1 },
  };
}

function codeFromInvite(url) { return codeOf(url); }
module.exports = { getMainChannel, channelContext, codeFromInvite };
