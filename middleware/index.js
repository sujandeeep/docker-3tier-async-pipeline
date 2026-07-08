const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env manually
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = value;
      }
    });
  }
} catch (e) {
  // Ignore env loading errors
}

const middlewareLogFile = path.join(__dirname, 'middleware.log');
const middlewareLogStream = fs.createWriteStream(middlewareLogFile, { flags: 'a' });

const frontendLogFile = path.join(__dirname, 'frontend.log');
const frontendLogStream = fs.createWriteStream(frontendLogFile, { flags: 'a' });

const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    return typeof arg === 'object' ? JSON.stringify(arg) : arg;
  }).join(' ');
  const timestamped = `[${new Date().toISOString()}] ${message}`;
  middlewareLogStream.write(timestamped + '\n');
  originalLog(`Middleware: ${timestamped}`);
};

console.error = function(...args) {
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    return typeof arg === 'object' ? JSON.stringify(arg) : arg;
  }).join(' ');
  const timestamped = `[${new Date().toISOString()}] ERROR: ${message}`;
  middlewareLogStream.write(timestamped + '\n');
  originalError(`Middleware: ERROR: ${timestamped}`);
};

let classifier = null;
async function getClassifier() {
  if (!classifier) {
    console.log('[Middleware] Initializing Toxic-BERT model via ONNX runtime...');
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = path.join(__dirname, '.cache');
    classifier = await pipeline('text-classification', 'Xenova/toxic-bert');
    console.log('[Middleware] Toxic-BERT model loaded successfully.');
  }
  return classifier;
}

const app = express();
const PORT = process.env.PORT || 3001;

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

// Global in-memory registry map to hold active SSE client responses
const sseClients = new Map();

// Enable CORS to support any origin (essential when accessing via remote IPs or custom hosts)
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Logger middleware
app.use((req, res, next) => {
  if (req.url !== '/api/v1/logs') {
    console.log(`[Middleware] Ingress: ${req.method} request to ${req.url}`);
  }
  next();
});

// Endpoint to receive frontend and backend logs
app.post('/api/v1/logs', (req, res) => {
  const { level, message, source } = req.body;
  const logSource = source || 'frontend';
  const formatted = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;

  if (logSource === 'backend') {
    if (level === 'error') {
      originalError(`Backend: ERROR: ${message}`);
    } else {
      originalLog(`Backend: ${message}`);
    }
  } else {
    frontendLogStream.write(formatted);
    const timestamped = `[${new Date().toISOString()}] ${message}`;
    if (level === 'error') {
      originalError(`Frontend: ERROR: ${timestamped}`);
    } else {
      originalLog(`Frontend: ${timestamped}`);
    }
  }
  res.sendStatus(204);
});

// Basic Authentication Middleware
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Logs Dashboard"');
    return res.status(401).send('Authentication required.');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];

  const adminUser = process.env.LOGS_USER || 'admin';
  const adminPass = process.env.LOGS_PASS || 'sujanlogs';

  if (user === adminUser && pass === adminPass) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Logs Dashboard"');
  return res.status(401).send('Invalid credentials.');
};

// Helper function to escape HTML to prevent XSS
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Endpoint to display secure system logs
app.get('/admin/logs', basicAuth, async (req, res) => {
  try {
    const middlewareLog = fs.existsSync(middlewareLogFile) ? fs.readFileSync(middlewareLogFile, 'utf8') : 'No middleware logs yet.';
    const frontendLog = fs.existsSync(frontendLogFile) ? fs.readFileSync(frontendLogFile, 'utf8') : 'No frontend logs yet.';

    let backendLog = 'No backend logs yet.';
    try {
      const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3002';
      const backendLogsResponse = await new Promise((resolve, reject) => {
        http.get(`${backendUrl}/internal/logs`, (response) => {
          let data = '';
          response.on('data', (chunk) => data += chunk);
          response.on('end', () => resolve({ ok: response.statusCode === 200, body: data }));
        }).on('error', reject);
      });
      if (backendLogsResponse.ok) {
        backendLog = backendLogsResponse.body;
      } else {
        backendLog = `Error fetching backend logs: Status ${backendLogsResponse.status}`;
      }
    } catch (e) {
      backendLog = `Backend log service unreachable: ${e.message}`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>System Logs Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-secondary: #131b2e;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent: #3b82f6;
      --border: rgba(255, 255, 255, 0.08);
      --glass: rgba(19, 27, 46, 0.7);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }
    h1 {
      font-size: 2rem;
      background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .refresh-btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.3s ease;
    }
    .refresh-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
    }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .tab-btn {
      background: var(--glass);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 12px 24px;
      border-radius: 10px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
      transition: all 0.3s ease;
    }
    .tab-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .log-view {
      background: var(--glass);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      height: 600px;
      overflow-y: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #cbd5e1;
      white-space: pre-wrap;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>System Logs Dashboard</h1>
      <button class="refresh-btn" onclick="window.location.reload()">Refresh Logs</button>
    </header>
    
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab(event, 'frontend')">Frontend Logs</button>
      <button class="tab-btn" onclick="switchTab(event, 'middleware')">Middleware Logs</button>
      <button class="tab-btn" onclick="switchTab(event, 'backend')">Backend Logs</button>
    </div>

    <div id="frontend" class="tab-content active">
      <div class="log-view">${escapeHtml(frontendLog)}</div>
    </div>
    <div id="middleware" class="tab-content">
      <div class="log-view">${escapeHtml(middlewareLog)}</div>
    </div>
    <div id="backend" class="tab-content">
      <div class="log-view">${escapeHtml(backendLog)}</div>
    </div>
  </div>

  <script>
    function switchTab(evt, tabId) {
      const tabContents = document.getElementsByClassName('tab-content');
      for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].classList.remove('active');
      }
      const tabBtns = document.getElementsByClassName('tab-btn');
      for (let i = 0; i < tabBtns.length; i++) {
        tabBtns[i].classList.remove('active');
      }
      document.getElementById(tabId).classList.add('active');
      evt.currentTarget.classList.add('active');
    }
    
    window.onload = () => {
      const logs = document.getElementsByClassName('log-view');
      for (let i = 0; i < logs.length; i++) {
        logs[i].scrollTop = logs[i].scrollHeight;
      }
    }
  </script>
</body>
</html>`;
    res.send(html);
  } catch (err) {
    res.status(500).send(`Server Error: ${err.message}`);
  }
});

// 1. Connection Handshake (SSE Entrypoint)
app.get('/stream', (req, res) => {
  const clientId = req.query.clientId;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId query parameter is required for routing.' });
  }

  console.log(`[Middleware] Handshake requested for clientId: ${clientId}`);

  // Set response headers for SSE stream (res.setHeader preserves CORS headers in Chrome)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Prevent Nginx buffering
  
  // Flush headers immediately to establish the connection channel
  res.flushHeaders();

  // Write initial connection status data
  res.write(`data: ${JSON.stringify({ status: 'connected', clientId })}\n\n`);

  // Add the response socket to our active registry
  sseClients.set(clientId, res);

  // Send periodic heartbeats (pings) to prevent TCP connection timeouts
  const heartbeatTimer = setInterval(() => {
    res.write(': heartbeat ping\n\n');
  }, 15000);

  // Clean up when the client closes the connection
  req.on('close', () => {
    console.log(`[Middleware] SSE connection closed for clientId: ${clientId}`);
    clearInterval(heartbeatTimer);
    sseClients.delete(clientId);
  });
});

// 2. Job Ingestion Endpoint (Returns HTTP 202 Accepted immediately)
app.post('/api/v1/jobs', async (req, res) => {
  const { name, clientId } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name parameter is required and must be a string' });
  }
  if (!clientId || typeof clientId !== 'string') {
    return res.status(400).json({ error: 'clientId is required for SSE connection mapping' });
  }

  try {
    // 1. Edge content moderation using local Toxic-BERT model
    const model = await getClassifier();
    const classification = await model(name);

    let isToxic = false;
    let toxicScore = 0;

    if (Array.isArray(classification)) {
      for (const prediction of classification) {
        if (Array.isArray(prediction)) {
          for (const subPred of prediction) {
            const labelLower = (subPred.label || '').toLowerCase();
            if (labelLower !== 'none' && labelLower !== 'clean' && labelLower !== 'normal') {
              if (subPred.score > 0.5) {
                isToxic = true;
                toxicScore = Math.max(toxicScore, subPred.score);
              }
            }
          }
        } else {
          const labelLower = (prediction.label || '').toLowerCase();
          if (labelLower !== 'none' && labelLower !== 'clean' && labelLower !== 'normal') {
            if (prediction.score > 0.5) {
              isToxic = true;
              toxicScore = Math.max(toxicScore, prediction.score);
            }
          }
        }
      }
    }

    if (isToxic) {
      console.log(`[Middleware] [TOXIC DETECTED] Input "${name}" classified as toxic (score: ${toxicScore.toFixed(4)}). Initiating instant bypass...`);
      
      // Return HTTP 202 immediately to free client socket
      res.status(202).json({
        status: 'Accepted',
        message: 'Job received'
      });

      // Push "speechViolation" SSE event instantly down the open channel
      const clientSocket = sseClients.get(clientId);
      if (clientSocket) {
        console.log(`[Middleware] Pushing speechViolation event to clientId: ${clientId}`);
        clientSocket.write(`event: speechViolation\ndata: ${JSON.stringify({ error: "Offensive Speech Detected" })}\n\n`);
      } else {
        console.log(`[Middleware] [Warning] No active SSE socket found for clientId: ${clientId} to deliver speechViolation event.`);
      }
      return;
    }

    // 2. Clean input path: forward to backend-service
    console.log(`[Middleware] Forwarding clean job for "${name}" (Client: ${clientId}) to backend-service...`);
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3002';
    const backendResponse = await postJson(`${backendUrl}/internal/process`, { name, clientId });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Middleware] Backend error response: ${backendResponse.status} - ${errorText}`);
      return res.status(backendResponse.status).json({ error: 'Backend service failed to queue request' });
    }

    console.log(`[Middleware] Backend service accepted job. Returning HTTP 202 Accepted to ${clientId}`);
    res.status(202).json({
      status: 'Accepted',
      message: 'Job received and is processing asynchronously'
    });
  } catch (error) {
    console.error(`[Middleware] Error in job processing:`, error);
    res.status(502).json({ error: 'Bad Gateway. Model or Backend service is currently unavailable.' });
  }
});

// 3. Webhook Callback Ingress (Backend calls back here once job completes)
app.post('/internal/callback', (req, res) => {
  const { clientId, result } = req.body;

  if (!clientId || !result) {
    return res.status(400).json({ error: 'clientId and result are required in callback body' });
  }

  console.log(`[Middleware] Processing callback for clientId: ${clientId}`);

  // Lookup the active SSE response object in registry
  const clientResponse = sseClients.get(clientId);

  if (clientResponse) {
    // Write event structure to client SSE channel
    clientResponse.write(`event: job_completed\ndata: ${JSON.stringify({ result })}\n\n`);
    console.log(`[Middleware] Pushed completed data event to clientId: ${clientId}`);
    
    // Acknowledge receipt back to Backend Service
    return res.status(200).json({ status: 'delivered' });
  } else {
    console.warn(`[Middleware] Received callback but found no active SSE socket for clientId: ${clientId}`);
    return res.status(404).json({ error: `No active stream connection found for client: ${clientId}` });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Middleware] API Gateway listening on port ${PORT}`);
});
