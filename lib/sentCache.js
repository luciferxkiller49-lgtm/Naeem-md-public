// Bot ke bheje hue messages ka chhota cache (har number ka alag, sirf RAM, sirf aakhri N).
// Zaroorat: jab group ka koi member bot ka message decrypt na kar sake to WhatsApp wohi message dobara maangta hai.
// Thumbnails (bade buffers) yaad nahi rakhte — sirf wo hissa jo dobara bhejne ke liye chahiye.
function slim(message) {
  if (!message || typeof message !== 'object') return message;
  const out = {};
  for (const [k, v] of Object.entries(message)) {
    if (v && typeof v === 'object' && v.jpegThumbnail) {
      const { jpegThumbnail, ...rest } = v;
      out[k] = rest;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function createSentCache(max = 40) {
  const m = new Map(); // messageId -> message content (slim)
  const api = {
    remember(res) {
      const id = res?.key?.id;
      if (!id || !res.message) return;
      m.set(id, slim(res.message));
      if (m.size > max) m.delete(m.keys().next().value);
    },
    getMessage: async (key) => m.get(key?.id),
    // sock.sendMessage ko lapet kar har bheja hua message yaad ho jaye
    wrap(sock) {
      const orig = sock.sendMessage.bind(sock);
      sock.sendMessage = async (...args) => {
        const res = await orig(...args);
        try { api.remember(res); } catch (e) {}
        return res;
      };
    },
    size: () => m.size,
  };
  return api;
}

module.exports = { createSentCache };
