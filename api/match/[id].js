'use strict';

// Vercel serverless route for a single match's detail (goals, cards, subs).
// Mirrors the /api/match/:id endpoint in proxy.js so live event data works
// in production as well as locally.
const { resolveOrigin } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  const origin = resolveOrigin(req.headers && req.headers.origin, req.headers && req.headers.host);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
  if (!FOOTBALL_DATA_KEY) {
    res.status(500).json({ error: 'Server misconfigured: missing API key.' });
    return;
  }

  // Vercel populates req.query.id from the [id] path segment.
  const matchId = String((req.query && req.query.id) || '');
  if (!/^\d+$/.test(matchId)) {
    res.status(400).json({ error: 'Invalid match ID.' });
    return;
  }

  try {
    const upstream = await fetch(
      `https://api.football-data.org/v4/matches/${matchId}`,
      { headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } },
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
