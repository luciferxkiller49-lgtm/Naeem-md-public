const config = require('../config');

/**
 * Middleware to authenticate requests from the Central Panel
 * Checks x-panel-key header against PANEL_KEY
 */
function panelAuth(req, res, next) {
  const incomingKey = req.headers['x-panel-key'] || req.query.key;

  if (!config.PANEL_KEY) {
    // If PANEL_KEY is not configured, allow for testing (warn in logs)
    console.warn('[SECURITY] PANEL_KEY not set. Allowing request unauthenticated.');
    return next();
  }

  if (incomingKey && incomingKey === config.PANEL_KEY) {
    return next();
  }

  console.warn(`[SECURITY] Unauthorized panel access attempt from ${req.ip}`);
  return res.status(401).json({
    error: 'Unauthorized: Invalid or missing x-panel-key header.'
  });
}

module.exports = panelAuth;
