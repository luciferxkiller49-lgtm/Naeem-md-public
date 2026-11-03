const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const config = require('./config');
const botManager = require('./bot');
const panelAuth = require('./lib/panelAuth');
const capacity = require('./lib/capacity');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mongoClient = null;

// Specification endpoint 3: GET /active -> { count, limit }
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

// Specification endpoint 3: GET /code?number=XXXX -> returns pairing code if count < 50
app.get(['/code', '/api/code', '/api/pair'], panelAuth, async (req, res) => {
  const number = req.query.number || req.query.phone;

  if (!number) {
    return res.status(400).json({ error: 'Phone number parameter missing. e.g. /code?number=923001234567' });
  }

  const cleanNumber = number.replace(/[^0-9]/g, '');
  if (cleanNumber.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }

  // Check capacity limit: 50
  if (capacity.isFull() || botManager.getActiveCount() >= config.MAX_LIMIT) {
    return res.status(429).json({
      error: 'full',
      message: `Node #${config.APP_ID} has reached maximum capacity (${config.MAX_LIMIT}).`,
      count: botManager.getActiveCount(),
      limit: config.MAX_LIMIT
    });
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

// Root & Health check
app.get(['/', '/health'], (req, res) => {
  res.json({
    bot: config.BOT_NAME,
    edition: 'Extreme Edition',
    appId: config.APP_ID,
    status: 'online',
    activeSessions: botManager.getActiveCount(),
    limit: config.MAX_LIMIT,
    uptime: Math.floor(process.uptime())
  });
});

// Diagnostics endpoint (protected by panelAuth)
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

// Initialize MongoDB and start bot service
async function start() {
  if (config.MONGODB_URI) {
    try {
      console.log(`[INIT] Connecting to MongoDB...`);
      mongoClient = new MongoClient(config.MONGODB_URI);
      await mongoClient.connect();
      const db = mongoClient.db('naeembot');
      console.log(`[INIT] Connected to MongoDB database 'naeembot'.`);

      await botManager.init(db);
    } catch (err) {
      console.error(`[INIT] MongoDB connection failed:`, err.message);
    }
  } else {
    console.warn(`[INIT] WARNING: MONGODB_URI not provided. Running in memory-only mode.`);
  }

  app.listen(config.PORT, () => {
    console.log(`====================================================`);
    console.log(`  NAEEMXLUCIFER-MD BOT NODE #${config.APP_ID} RUNNING`);
    console.log(`  Port: ${config.PORT}`);
    console.log(`  Max Limit: ${config.MAX_LIMIT} Numbers`);
    console.log(`====================================================`);
  });
}

start();
