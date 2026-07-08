const express = require('express');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'backend.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const originalLog = console.log;
const originalError = console.error;

let isLogging = false;
function sendLogToGateway(level, message) {
  if (isLogging) return;
  isLogging = true;
  const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:3001';
  postJson(`${gatewayUrl}/api/v1/logs`, { level, source: 'backend', message })
    .catch(() => {})
    .finally(() => {
      isLogging = false;
    });
}

console.log = function(...args) {
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    return typeof arg === 'object' ? JSON.stringify(arg) : arg;
  }).join(' ');
  const timestamped = `[${new Date().toISOString()}] ${message}`;
  logStream.write(timestamped + '\n');
  originalLog(timestamped);
  sendLogToGateway('info', timestamped);
};

console.error = function(...args) {
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    return typeof arg === 'object' ? JSON.stringify(arg) : arg;
  }).join(' ');
  const timestamped = `[${new Date().toISOString()}] ERROR: ${message}`;
  logStream.write(timestamped + '\n');
  originalError(timestamped);
  sendLogToGateway('error', timestamped);
};

const app = express();
const PORT = process.env.PORT || 3002;

const http = require('http');

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postData = JSON.stringify(data);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(body),
          json: () => Promise.resolve(JSON.parse(body || '{}'))
        });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

app.use(express.json());

// Log requests
app.use((req, res, next) => {
  console.log(`[Backend] Incoming ${req.method} request to ${req.url}`);
  next();
});

// Asynchronous background job endpoint
app.post('/internal/process', (req, res) => {
  const { name, clientId } = req.body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name payload must be a string' });
  }
  if (!clientId || typeof clientId !== 'string') {
    return res.status(400).json({ error: 'clientId payload must be a string' });
  }

  console.log(`[Backend] Job received for name: "${name}" (Client: ${clientId}). Scheduling delay.`);

  // 1. Immediately acknowledge the job back to the Gateway (non-blocking)
  res.status(200).json({
    status: 'scheduled',
    message: 'Job successfully scheduled for background computation.'
  });

  // 2. Execute the 5-second asynchronous processing delay via event loop macrotask
  setTimeout(async () => {
    console.log(`[Backend] Processing finished for clientId: "${clientId}". Dispatching callback...`);

    const resultPayload = `Hello, ${name}!`;

    try {
      // 3. Fire Callback HTTP POST request back to Middleware Gateway inside Docker bridge network
      const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:3001';
      const gatewayResponse = await postJson(`${gatewayUrl}/internal/callback`, {
        clientId: clientId,
        result: resultPayload
      });

      if (gatewayResponse.ok) {
        console.log(`[Backend] Callback acknowledged by Gateway for clientId: "${clientId}"`);
      } else {
        const errText = await gatewayResponse.text();
        console.error(`[Backend] Callback rejected by Gateway with status ${gatewayResponse.status}: ${errText}`);
      }
    } catch (err) {
      console.error(`[Backend] Failed to send callback to Gateway:`, err.message);
    }
  }, 5000);
});

// Endpoint to retrieve backend logs internally
app.get('/internal/logs', (req, res) => {
  fs.readFile(logFile, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read backend logs' });
    }
    res.type('text/plain').send(data || 'No backend logs yet.');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Backend] Isolated Service listening on port ${PORT}`);
});
