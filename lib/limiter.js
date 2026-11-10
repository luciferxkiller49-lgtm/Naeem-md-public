// Ek waqt mein sirf N ffmpeg chalne dete hain (baqi qatar mein) — 512MB dyno par CPU/RAM ka dabao rokne ke liye.
// FFMPEG_CONCURRENCY Config Var se badla ja sakta hai (default 2).
const MAX = Math.max(1, parseInt(process.env.FFMPEG_CONCURRENCY || '2', 10));
let running = 0;
const waiting = [];

function acquire() {
  if (running < MAX) { running++; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

async function limited(fn) {
  await acquire();
  try { return await fn(); } finally { release(); }
}

module.exports = { limited };
