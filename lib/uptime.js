const started = Date.now();
function getUptimeText() {
  const s = Math.floor((Date.now() - started) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s % 60}s`;
}
module.exports = { getUptimeText };
