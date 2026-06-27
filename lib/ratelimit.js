'use strict';

/*
 * Simple in-memory, fixed-window rate limiter keyed by client IP.
 *
 * Defaults: 30 AI requests per hour per IP — enough for a curious judge to
 * try every feature several times, while blocking automated abuse of the
 * (paid) AI keys.
 *
 * NOTE: in-memory state is per-process. On Vercel serverless this resets on
 * cold starts and is not shared across instances, so treat it as best-effort
 * abuse protection. For a hard guarantee use a shared store such as Vercel KV
 * or Upstash Redis. For the local proxy.js (single process) it is exact.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_HITS  = 30;             // requests per window per IP
const hits = new Map();

function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) ||
         (req.connection && req.connection.remoteAddress) ||
         'unknown';
}

function checkRateLimit(req) {
  const now = Date.now();

  // Occasional cleanup so the Map doesn't grow without bound.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }

  const ip = clientIp(req);
  let rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    rec = { count: 0, reset: now + WINDOW_MS };
  }
  rec.count += 1;
  hits.set(ip, rec);

  if (rec.count > MAX_HITS) {
    const mins = Math.max(1, Math.ceil((rec.reset - now) / 60000));
    return {
      allowed: false,
      message: `Rate limit reached (${MAX_HITS} requests per hour). Please try again in about ${mins} minute(s).`,
    };
  }
  return { allowed: true, remaining: MAX_HITS - rec.count };
}

module.exports = { checkRateLimit, MAX_HITS };
