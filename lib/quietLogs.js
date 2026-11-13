const pino = require('pino');

// libsignal har session change par poora object print karta hai — Heroku logs bhar jaate hain
const NOISY = /^(Closing session|Closing open session|Removing old closed session|Opening session|Migrating session|Session already|Failed to decrypt message with any known session|Session error)/;
for (const m of ['log', 'info', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...args) => {
    if (typeof args[0] === 'string' && NOISY.test(args[0])) return;
    orig(...args);
  };
}

/**
 * Clean logger for Baileys to suppress noisy signal/session traces
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'fatal', // 'warn' par har decrypt error ka poora object print hota tha (CPU + logs)
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

module.exports = logger;

// Koi ek unexpected error poore bot ko crash na kare (crash par WhatsApp sessions save hone se reh jaate hain)
process.on('uncaughtException', (err) => console.error('[PROCESS] uncaughtException:', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (err) => console.error('[PROCESS] unhandledRejection:', err && err.stack ? err.stack : err));
