// Channel helpers: link se channel ki jid / role (sirf metadata, koi post nahi), aur channels ki yaad (instance settings).
const CHANNEL_REACT_EMOJI = process.env.CHANNEL_REACT_EMOJI || '❤️';

function codeOfChannel(link) {
  const m = /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/.exec(String(link || ''));
  return m ? m[1] : null;
}

async function resolveChannel(sock, link) {
  const code = codeOfChannel(link);
  if (!code) throw new Error('Channel ka sahi link dein (https://whatsapp.com/channel/...)');
  let meta;
  try { meta = await sock.newsletterMetadata('invite', code); }
  catch (e) { throw new Error(`Channel ki maloomat nahi mili: ${e.message}`); }
  if (!meta || !meta.id) throw new Error('Channel nahi mila (link galat ya expire ho sakta hai)');
  return { jid: meta.id, name: meta.name || 'channel' };
}

// Viewer role (ADMIN / OWNER / SUBSCRIBER / GUEST) jid wali query se
async function roleOf(sock, jid) {
  const m = await sock.newsletterMetadata('jid', jid).catch(() => null);
  return String(m?.viewer_metadata?.role || 'GUEST').toUpperCase();
}

// Channel ko yaad rakho taake ".chstatus all" usi list par chal sake
async function rememberChannel(number, ch) {
  const store = require('./store');
  const s = await store.getInstanceSettings(number);
  const list = Array.isArray(s.knownChannels) ? s.knownChannels : [];
  if (list.some((c) => c.jid === ch.jid)) return;
  await store.setInstanceSettings(number, { knownChannels: [...list, { jid: ch.jid, name: ch.name }].slice(-50) });
}

async function knownChannels(number) {
  const s = await require('./store').getInstanceSettings(number);
  return Array.isArray(s.knownChannels) ? s.knownChannels : [];
}

module.exports = { resolveChannel, roleOf, rememberChannel, knownChannels, codeOfChannel, CHANNEL_REACT_EMOJI };
