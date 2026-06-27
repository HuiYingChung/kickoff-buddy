'use strict';

// /api/ai — chat completions served by IBM Granite via watsonx.ai.
// Used for features that do NOT need live web search
// (Match Guide, Choose My Team, Matchday Guide).

const { watsonxChat }    = require('../lib/watsonx');
const { checkRateLimit } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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
