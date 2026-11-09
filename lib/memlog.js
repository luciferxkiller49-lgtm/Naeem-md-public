// Memory ka hisaab: har 2 minute mein ek line, taake pata chale har number kitni RAM leta hai
const MB = 1024 * 1024;
const mb = (n) => Math.round(n / MB);

function snapshot(sessions) {
  const m = process.memoryUsage();
  return { rssMB: mb(m.rss), heapUsedMB: mb(m.heapUsed), heapTotalMB: mb(m.heapTotal), externalMB: mb(m.external), buffersMB: mb(m.arrayBuffers), sessions };
}

function start(getSessions) {
  const log = () => {
    const s = snapshot(getSessions());
    console.log(`[MEM] rss=${s.rssMB}MB heap=${s.heapUsedMB}MB external=${s.externalMB}MB buffers=${s.buffersMB}MB sessions=${s.sessions} (Heroku limit 512MB)`);
  };
  setTimeout(log, 20000).unref();
  setInterval(log, 2 * 60 * 1000).unref();
}

module.exports = { start, snapshot };
