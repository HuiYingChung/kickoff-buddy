'use strict';

// /api/ai — chat completions served by IBM Granite via watsonx.ai.
// Used for features that do NOT need live web search
// (Match Guide, Choose My Team, Matchday Guide).

const { watsonxChat }    = require('../lib/watsonx');
const { checkRateLimit } = require('../lib/ratelimit');
const { resolveOrigin }  = require('../lib/cors');

module.exports = async function handler(req, res) {
  const origin = resolveOrigin(req.headers && req.headers.origin, req.headers && req.headers.host);
  if (origin === null) {
    res.status(403).json({ error: { message: 'Origin not allowed.' } });
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const rl = checkRateLimit(req);
  if (!rl.allowed) {
    res.status(429).json({ error: { message: rl.message } });
    return;
  }

  const body = req.body || {};
  const result = await watsonxChat({
    messages:    body.messages    || [],
    maxTokens:   body.max_tokens  ?? 900,
    temperature: body.temperature ?? 0.7,
  });

  res.status(result.status).json(result.data);
};
