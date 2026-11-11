const started = Date.now();

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s % 60}s`;
}

function getUptimeText() {
  return formatDuration(Date.now() - started);
}

module.exports = { getUptimeText, formatDuration };
