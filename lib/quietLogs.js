const pino = require('pino');

/**
 * Clean logger for Baileys to suppress noisy signal/session traces
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

module.exports = logger;
