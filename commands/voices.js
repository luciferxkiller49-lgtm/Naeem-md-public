// Voices: assets/voices/sad1.mp3, sad2.mp3 ... — user "sad1" likhe (ya .sad1) to voice bheji jati hai.
// Har voice ek command ban jati hai (category "sad sang", menu mein alag group). File request par parhi jati hai
// (RAM mein sab ek saath nahi rakhte, taake bot ki speed par asar na ho).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'voices');
const byNumber = (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0);

function listVoices() {
  try {
    return fs.readdirSync(DIR)
      .filter((f) => /\.mp3$/i.test(f))
      .map((f) => f.replace(/\.mp3$/i, '').toLowerCase())
      .sort(byNumber);
  } catch (e) {
    return [];
  }
}

module.exports = listVoices().map((name) => ({
  name,
  aliases: [],
  description: `Voice: ${name}`,
  category: 'sad sang',
  async execute(ctx) {
    const buf = fs.readFileSync(path.join(DIR, `${name}.mp3`));
    return ctx.sock.sendMessage(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.msg });
  },
}));
