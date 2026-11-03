const config = require('../config');

// FIX: added the 30-attempts-per-minute-per-IP limit described in the
// original project doc. In-memory only (resets on dyno restart, and is
// per-dyno rather than shared across all 10 apps) but stops a simple
// brute-force script from guessing PANEL_KEY.
const attempts = new Map(); // ip -> { count, windowStart }
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 30;

function isRateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count++;
  return rec.count > MAX_ATTEMPTS;
}

function panelAuth(req, res, next) {
  const raw = req.headers['x-panel-key'] || req.query.key || '';
  // FIX: trim whitespace and strip accidental quotes — a known cause of long
  // "Unauthorized" debugging sessions when a key gets pasted with quotes
  // into Heroku Config Vars.
  const incomingKey = String(raw).trim().replace(/^["']|["']$/g, '');

  if (isRateLimited(req.ip)) {
    console.warn(`[SECURITY] Rate limit exceeded for ${req.ip}`);
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  if (incomingKey && incomingKey === config.PANEL_KEY) {
    return next();
  }

  // Never log the actual key, only lengths — same "fingerprint, not value"
  // approach as the original project.
  console.warn(`[SECURITY] Unauthorized panel access attempt from ${req.ip} (got ${incomingKey.length} chars, expected ${config.PANEL_KEY.length})`);
  return res.status(401).json({
    error: 'Unauthorized: Invalid or missing x-panel-key header.'
  });
}

module.exports = panelAuth;
