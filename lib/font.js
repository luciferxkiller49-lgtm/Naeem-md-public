// "Tiny bold" style: english letters -> small caps, aur WhatsApp bold (*...*).
// Links, @mentions, commands (.promote), numbers aur IDs apni asli shakal mein rehte hain.
const MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

// In tokens ko chhua nahi jata
const PRESERVE = /^(https?:\/\/\S+|www\.\S+|\S+@\S+|@\S+|[.!#\/][A-Za-z]\w*\S*|\S*\d{4,}\S*)$/;

const toSmallCaps = (s) => s.replace(/[a-z]/gi, (c) => MAP[c.toLowerCase()]);
const hasLetters = (s) => /[A-Za-z]/.test(s);

function styleLine(line) {
  const parts = line.split(/(\s+)/);
  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const m = run.match(/^(\s*)([\s\S]*?)(\s*)$/);
    out += hasLetters(m[2]) ? `${m[1]}*${toSmallCaps(m[2])}*${m[3]}` : run;
    run = '';
  };
  for (const part of parts) {
    if (part && !/^\s+$/.test(part) && PRESERVE.test(part)) {
      flush();
      out += part;
    } else if (/^\s+$/.test(part) && out.length && run === '' ) {
      out += part;
    } else {
      run += part;
    }
  }
  flush();
  return out;
}

function tinyBold(text) {
  return String(text).split('\n').map(styleLine).join('\n');
}

module.exports = { tinyBold, toSmallCaps };
