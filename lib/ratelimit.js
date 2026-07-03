'use strict';

/*
 * Per-IP fixed-window rate limiter backed by Redis REST (zero npm deps; uses
 * the global fetch). State is shared across every serverless instance and
 * survives cold starts.
 *
 * This replaces the previous in-memory Map, which on Vercel serverless was
 * per-instance and reset on every cold start — so the limit was best-effort
 * and could be bypassed by spreading traffic across instances. The counter now
 * lives in Redis, so the limit is enforced globally.
 *
 * Default: 30 AI requests per hour per IP (both overridable via env). Stores
 * ONLY an anonymous integer counter that auto-expires (TTL); no IP is kept
 * beyond the window, and no message content is stored.
 *
 * Fail-DEGRADED (not fail-open): if Redis errors, or is unconfigured in
 * production, we do NOT allow the (paid) AI call — checkRateLimit returns
 * { allowed:false } so the caller 429s instead of spending on the model.
 * In local dev (no VERCEL_ENV=production) an unconfigured Redis passes through
 * so proxy.js and local testing still work. Errors are logged server-side only.
 *
 * Interface is unchanged for callers: checkRateLimit(req) resolves to
 * { allowed:true, remaining } or { allowed:false, message }. It is now async
 * (a network round-trip is unavoidable), so callers must `await` it.
 */

const MAX_HITS   = parseInt(process.env.KB_RL_MAX || '30', 10);        // requests per window per IP
const WINDOW_SEC = parseInt(process.env.KB_RL_WINDOW_SEC || '3600', 10); // window length (default 1 hour)
const KEY_PREFIX = 'kb:rl:';

const REST_URL      = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN    = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

function clientIp(req) {
  const h = (req && req.headers) || {};

  // Prefer headers the platform edge sets to the *true* client IP and that the
  // client cannot forge (Vercel / nginx overwrite these on the way in).
  // We deliberately do NOT trust the first value of `x-forwarded-for`: a caller
  // can prepend an arbitrary IP there to reset their rate-limit bucket.
  const real = h['x-real-ip'] || h['x-vercel-forwarded-for'];
  if (real) return String(real).split(',')[0].trim();

  // Direct connection (e.g. the local proxy.js): the socket address is genuine.
  return (req.socket && req.socket.remoteAddress) ||
         (req.connection && req.connection.remoteAddress) ||
         'unknown';
}

/* run a Redis pipeline over the REST API; returns array of results */
async function pipeline(commands) {
  const r = await fetch(REST_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('redis pipeline http ' + r.status);
  return r.json();
}

const UNAVAILABLE = 'Service temporarily unavailable. Please try again shortly.';

async function checkRateLimit(req) {
  if (!REST_URL || !REST_TOKEN) {
    // Unconfigured: fail-degraded in production (protect the paid API),
    // pass through in local dev so proxy.js / local testing still works.
    if (IS_PRODUCTION) return { allowed: false, message: UNAVAILABLE };
    return { allowed: true, remaining: MAX_HITS };
  }

  const key = KEY_PREFIX + clientIp(req);
  try {
    // INCR creates+bumps the counter; EXPIRE ... NX arms the TTL only on the
    // first hit of the window (so it's a fixed window, not a sliding one);
    // TTL gives us the seconds left for the retry message.
    const res = await pipeline([
      ['INCR', key],
      ['EXPIRE', key, String(WINDOW_SEC), 'NX'],
      ['TTL', key]
    ]);
    const count = Number((res[0] && res[0].result) || 0);
    const ttl   = Number((res[2] && res[2].result) || WINDOW_SEC);

    if (count > MAX_HITS) {
      const mins = Math.max(1, Math.ceil((ttl > 0 ? ttl : WINDOW_SEC) / 60));
      return {
        allowed: false,
        message: `Rate limit reached (${MAX_HITS} requests per hour). Please try again in about ${mins} minute(s).`,
      };
    }
    return { allowed: true, remaining: MAX_HITS - count };
  } catch (e) {
    console.error('[ratelimit] backend error:', e && e.message); // server-only
    // Can't enforce the limit -> don't spend on the paid model (fail-degraded).
    return { allowed: false, message: UNAVAILABLE };
  }
}

module.exports = { checkRateLimit, clientIp, MAX_HITS };
