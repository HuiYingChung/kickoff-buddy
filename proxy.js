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

const { watsonxChat }    = require('./lib/watsonx');
const { resolveOrigin }  = require('./lib/cors');
// NOTE: lib/ratelimit.js is intentionally NOT used here. proxy.js is the local
// dev server, where rate limiting would only ever throttle the developer.
// The deployed serverless handlers (api/ai.js, api/ai-search.js) DO enforce it.

const PORT              = process.env.PORT || 3001;
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;

// Fail fast if the keys needed for live match data + web search are missing.
if (!FOOTBALL_DATA_KEY) {
  console.error('ERROR: FOOTBALL_DATA_KEY environment variable is not set.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

// watsonx (Granite) powers /api/ai. Warn but don't exit if it's not yet
// configured, so the search-based features can still be tested.
if (!process.env.WATSONX_API_KEY || !process.env.WATSONX_PROJECT_ID || !process.env.WATSONX_URL) {
  console.warn('WARNING: WATSONX_API_KEY / WATSONX_PROJECT_ID / WATSONX_URL not all set — Granite (/api/ai) features will return an error until configured.');
}

// Small helper: send a JSON response.
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const MAX_BODY_BYTES = 16 * 1024; // 16 KB — enough for any prompt

const server = http.createServer((req, res) => {
  // Origin allowlist: echo only approved origins (never a wildcard), and below
  // we reject disallowed browser origins on the paid AI routes.
  const origin = resolveOrigin(req.headers && req.headers.origin, req.headers && req.headers.host);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Reject disallowed browser origins on the paid AI endpoints so other sites
  // can't spend the OpenAI / watsonx keys.
  const isAiRoute = req.url === '/api/ai' || req.url === '/api/ai-search';
  if (isAiRoute && origin === null) {
    sendJson(res, 403, { error: { message: 'Origin not allowed.' } });
    return;
  }

  // OpenAI Responses API with web_search_preview tool
  if (req.url === '/api/ai-search' && req.method === 'POST') {
    // NOTE: proxy.js is the LOCAL dev server (single developer). The shared
    // 30-req/hour limiter only ever throttles you during testing, so it is
    // disabled here. Deployed traffic goes through api/ai-search.js, which
    // keeps its own checkRateLimit — production protection is unaffected.

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
      let parsed;
      try { parsed = JSON.parse(body); }
      catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
        return;
      }

      const safe = JSON.stringify({
        model:             parsed.model             || 'gpt-4o',
        tools:             [{ type: 'web_search_preview' }],
        input:             parsed.input             || '',
        max_output_tokens: parsed.max_output_tokens ?? 1200,
      });

      const options = {
        hostname: 'api.openai.com',
        path:     '/v1/responses',
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

  // Granite proxy (IBM watsonx.ai) — keeps credentials server-side.
  if (req.url === '/api/ai' && req.method === 'POST') {
    // Local-only rate limiter disabled — see the note on /api/ai-search above.

    let body = '';
    let byteCount = 0;

    req.on('data', chunk => {
      byteCount += chunk.length;
      if (byteCount > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: { message: 'Request body too large.' } });
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON.' } });
        return;
      }

      const result = await watsonxChat({
        messages:    parsed.messages    || [],
        maxTokens:   parsed.max_tokens  ?? 900,
        temperature: parsed.temperature ?? 0.7,
      });
      sendJson(res, result.status, result.data);
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

  // Individual match detail endpoint (events: goals, cards, substitutions)
  if (req.url.startsWith('/api/match/') && req.method === 'GET') {
    const matchId = req.url.slice('/api/match/'.length).split('?')[0];
    if (!/^\d+$/.test(matchId)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid match ID.' }));
      return;
    }
    const options = {
      hostname: 'api.football-data.org',
      path:     `/v4/matches/${matchId}`,
      headers:  { 'X-Auth-Token': FOOTBALL_DATA_KEY },
    };
    https.get(options, apiRes => {
      let body = '';
      apiRes.on('data', chunk => body += chunk);
      apiRes.on('end', () => {
        res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(body);
      });
    }).on('error', err => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Serve static files.
  // Strip query string, then normalise to defend against path traversal.
  const urlPath  = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
  const safePath = path.normalize(urlPath);
  const filePath = path.join(__dirname, safePath);

  // 1) Must stay inside the project directory (no ../ escapes).
  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 2) Never serve dotfiles (e.g. .env, .gitignore) — they may hold secrets.
  if (path.basename(filePath).startsWith('.')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // 3) Only serve known, safe static file types. Anything else (including
  //    .js server files, .json with secrets, etc. is still allowed only via
  //    the explicit allowlist below).
  const ext = path.extname(filePath).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME, ext)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Kickoff Buddy proxy running at http://localhost:${PORT}`);
});
