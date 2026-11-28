// Ek waqt mein sirf N kaam chalne dete hain (baqi qatar mein) — 512MB dyno par CPU/RAM ka dabao rokne ke liye.
// ffmpeg: FFMPEG_CONCURRENCY Config Var (default 2). Downloads: downloader.js apna alag limiter banata hai.
function createLimiter(max) {
  const MAX = Math.max(1, max | 0);
  let running = 0;
  const waiting = [];
  const acquire = () => {
    if (running < MAX) { running++; return Promise.resolve(); }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else running--;
  };
  return async function limited(fn) {
    await acquire();
    try { return await fn(); } finally { release(); }
  };
}

const limited = createLimiter(parseInt(process.env.FFMPEG_CONCURRENCY || '2', 10));

module.exports = { limited, createLimiter };
