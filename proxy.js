// Kickoff Buddy — local proxy server
// Forwards football-data.org and OpenAI requests server-side.
// Run with: npm start  (or: node proxy.js)
// Required env vars: FOOTBALL_DATA_KEY, OPENAI_API_KEY  (put them in .env locally)
// Then open the app at http://localhost:3001

'use strict';

// Load .env file when running locally (ignored if already set by the platform)
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT              = process.env.PORT || 3001;
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;

// Fail fast if keys are missing — never fall back to hardcoded values
if (!FOOTBALL_DATA_KEY) {
  console.error('ERROR: FOOTBALL_DATA_KEY environment variable is not set.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const MAX_BODY_BYTES = 16 * 1024; // 16 KB — enough for any prompt

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // OpenAI proxy — keeps the API key server-side
  if (req.url === '/api/ai' && req.method === 'POST') {
    let body = '';
    let byteCount = 0;

    req.on('data', chunk => {
      byteCount += chunk.length;
      if (byteCount > MAX_BODY_BYTES) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'Request body too large.' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      // Validate JSON before forwarding
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
        return;
      }

      // Only allow the fields the app actually needs
      const safe = JSON.stringify({
        model:       parsed.model       || 'gpt-4o',
        messages:    parsed.messages    || [],
        max_tokens:  parsed.max_tokens  || 900,
        temperature: parsed.temperature || 0.7,
      });

      const options = {
        hostname: 'api.openai.com',
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(safe),
          'Authorization':  `Bearer ${OPENAI_API_KEY}`,
        },
      };

      const apiReq = https.request(options, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      apiReq.on('error', err => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      });

      apiReq.write(safe);
      apiReq.end();
    });

    return;
  }

  // Football data proxy endpoint
  if (req.url === '/api/matches') {
    const options = {
      hostname: 'api.football-data.org',
      path:     '/v4/competitions/WC/matches',
      headers:  { 'X-Auth-Token': FOOTBALL_DATA_KEY },
    };
    https.get(options, apiRes => {
      let body = '';
      apiRes.on('data', chunk => body += chunk);
      apiRes.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });
    }).on('error', err => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Serve static files — path traversal protection
  const safePath = path.normalize(req.url === '/' ? '/index.html' : req.url);
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Kickoff Buddy proxy running at http://localhost:${PORT}`);
});
