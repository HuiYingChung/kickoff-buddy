'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
  if (!FOOTBALL_DATA_KEY) {
    res.status(500).json({ error: 'Server misconfigured: missing API key.' });
    return;
  }

  try {
    const upstream = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY },
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
