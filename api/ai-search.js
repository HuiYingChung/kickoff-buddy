'use strict';

// /api/ai-search — OpenAI Responses API with the web_search_preview tool.
// Used for features that may need current facts
// (Ask What Just Happened, Decision Explainer, Momentum & Tactics).

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
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rl = await checkRateLimit(req);
  if (!rl.allowed) {
    res.status(429).json({ error: { message: rl.message } });
    return;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'Server misconfigured: missing API key.' });
    return;
  }

  const body = req.body || {};
  const payload = JSON.stringify({
    model:             body.model             || 'gpt-4o',
    tools:             [{ type: 'web_search_preview' }],
    input:             body.input             || '',
    max_output_tokens: body.max_output_tokens ?? 1200,
  });

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: payload,
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
