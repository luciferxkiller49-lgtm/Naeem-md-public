const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const config = require('./config');
const botManager = require('./bot');
const panelAuth = require('./lib/panelAuth');
const capacity = require('./lib/capacity');
const memlog = require('./lib/memlog');
const fleet = require('./lib/fleet');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mongoClient = null;

// APP_ID set na ho to ye server pairing/bot ke liye band hai: har request par saaf error (panel doosra server chun le)
const APP_ID_ERR = 'Is server par APP_ID set nahi hai, isliye ye server use nahi ho sakta. Koi doosra server select karein.';
app.use((req, res, next) => {
  if (!config.APP_ID_MISSING) return next();
  return res.status(503).json({
    error: 'app_id_missing',
    message: APP_ID_ERR,
    available: false,
    online: false,
    status: 'misconfigured',
  });
});

// GET /active -> { count, limit }
app.get('/active', (req, res) => {
  const status = capacity.getStatus();
  res.json({
    appId: config.APP_ID,
    count: botManager.getActiveCount(),
    limit: status.limit,
    available: !capacity.isFull(),
    online: true,
    totalInstances: botManager.instances.size
  });
});

// GET /code?number=XXXX -> pairing code if count < 50
app.get(['/code', '/api/code', '/api/pair'], panelAuth, async (req, res) => {
  const number = req.query.number || req.query.phone;

  if (!number) {
    return res.status(400).json({ error: 'Phone number parameter missing. e.g. /code?number=923001234567' });
  }

  const cleanNumber = number.replace(/[^0-9]/g, '');
  if (cleanNumber.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }

  if (capacity.isFull() || botManager.getActiveCount() >= config.MAX_LIMIT) {
    return res.status(429).json({
      error: 'full',
      message: `Node #${config.APP_ID} has reached maximum capacity (${config.MAX_LIMIT}).`,
      count: botManager.getActiveCount(),
      limit: config.MAX_LIMIT
    });
  }

  if (!botManager.ready) {
    return res.status(503).json({ error: 'starting', message: 'This node is still starting, try again in a few seconds.' });
  }

  try {
    console.log(`[API] Generating pairing code for +${cleanNumber} on Node #${config.APP_ID}...`);
    const result = await botManager.addInstance(cleanNumber);

    return res.json({
      success: true,
      code: result.code,
      number: cleanNumber,
      appId: config.APP_ID,
      message: 'Pairing code successfully issued.'
    });
  } catch (err) {
    console.error(`[API] Pairing error for +${cleanNumber}:`, err.message);
    return res.status(500).json({
      error: 'Pairing code generation failed: ' + err.message
    });
  }
});

app.get(['/', '/health'], (req, res) => {
  res.json({
    bot: config.BOT_NAME,
    edition: 'Extreme Edition',
    appId: config.APP_ID,
    status: 'online',
    activeSessions: botManager.getActiveCount(),
    limit: config.MAX_LIMIT,
    memory: memlog.snapshot(botManager.getActiveCount()),
    uptime: Math.floor(process.uptime())
  });
});

app.get('/status', panelAuth, (req, res) => {
  const list = [];
  botManager.instances.forEach((inst, num) => {
    list.push({ number: num, status: inst.status });
  });

  res.json({
    appId: config.APP_ID,
    activeCount: botManager.getActiveCount(),
    limit: config.MAX_LIMIT,
    instances: list
  });
});

// FIX: previously, if MongoDB failed to connect the app still called
// app.listen() and kept running with sessionsCol === null. The very first
// /code request would then crash trying to read a property of null, with a
// confusing error. This is a Mongo-only app (no local file sessions), so if
// Mongo is unreachable there is nothing useful this dyno can do — exit so
// Heroku restarts it instead of serving broken requests.
async function start() {
  if (config.APP_ID_MISSING) {
    // Crash nahi: server chalta rahe taake panel ko 503 + saaf message mile (upar wala middleware)
    app.listen(config.PORT, () => console.error('[INIT] APP_ID missing: sirf error-mode mein chal raha hai (koi bot session load nahi hua).'));
    return;
  }
  if (!config.MONGODB_URI) {
    console.error('[INIT] FATAL: MONGODB_URI not set.');
    process.exit(1);
  }

  try {
    console.log(`[INIT] Connecting to MongoDB...`);
    mongoClient = new MongoClient(config.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db('naeembot');
    console.log(`[INIT] Connected to MongoDB database 'naeembot'.`);

    // PEHLE port par sunna shuru (Heroku boot timeout se bachne ke liye), phir numbers resume hote hain
    app.listen(config.PORT, () => {
      console.log(`====================================================`);
      console.log(`  ${config.BOT_NAME} BOT NODE #${config.APP_ID} RUNNING`);
      console.log(`  Port: ${config.PORT}`);
      console.log(`  Max Limit: ${config.MAX_LIMIT} Numbers`);
      console.log(`====================================================`);
    });

    memlog.start(() => botManager.getActiveCount());
    await botManager.init(db);
    require('./lib/pairRouter').startWorker(botManager); // doosre nodes ki pairing requests
    fleet.start(db, botManager); // har minute apna heartbeat Mongo mein (.botstatus ke liye)
  } catch (err) {
    console.error(`[INIT] Startup failed:`, err.message);
    process.exit(1);
  }
}

start();
