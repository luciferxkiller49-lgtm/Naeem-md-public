// Channel ke link se channel ki jid / role nikalna (sirf metadata, koi post nahi).
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
  // Viewer role (admin/owner) aksar jid wali query se hi aata hai, is liye dobara jid se maangte hain
  let role = meta.viewer_metadata?.role;
  try {
    const m2 = await sock.newsletterMetadata('jid', meta.id);
    role = m2?.viewer_metadata?.role || role;
  } catch (e) { /* invite wala role hi kaafi hai */ }
  return { jid: meta.id, name: meta.name || 'channel', role: String(role || 'GUEST').toUpperCase() };
}

module.exports = { resolveChannel, codeOfChannel, CHANNEL_REACT_EMOJI };
