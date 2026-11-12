// Bot ke bheje hue messages ka chhota cache (har number ka alag, sirf RAM, sirf aakhri N).
// Zaroorat: jab group ka koi member bot ka message decrypt na kar sake to WhatsApp bot se wohi message dobara
// maangta hai (retry request). Library ye message `getMessage` se leti hai — pehle ye tha hi nahi, is liye us member ko
// "Waiting for this message" dikhta rehta tha aur bot ka jawab kabhi nahi pohanchta tha.
function createSentCache(max = 150) {
  const m = new Map(); // messageId -> message content
  const api = {
    remember(res) {
      const id = res?.key?.id;
      if (!id || !res.message) return;
      m.set(id, res.message);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    getMessage: async (key) => m.get(key?.id),
    // sock.sendMessage ko is tarah lapetna ke har bheja hua message yaad ho jaye
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
