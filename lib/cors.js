'use strict';

/*
 * Origin allowlist for the API endpoints.
 *
 * The paid AI proxies (/api/ai, /api/ai-search) must not be a free, open relay
 * for anyone's website to spend the OpenAI / watsonx keys. We therefore reject
 * browser requests whose Origin is not allowed.
 *
 * An origin is allowed when ANY of these hold:
 *   1. It is the SAME origin the page was served from (Origin host === Host).
 *      This is the normal case for the app calling its own API, so it works
 *      with zero configuration and the app can never lock itself out.
 *   2. It is localhost / 127.0.0.1 (any port) — for local development.
 *   3. It is listed in the ALLOWED_ORIGINS env var (comma-separated) — only
 *      needed to permit ADDITIONAL cross-origin frontends, e.g.
 *        ALLOWED_ORIGINS=https://staging.kickoffbuddy.com
 *
 * Note on limits: CORS / Origin checks only stop *browser* abuse from other
 * sites — a hand-crafted request (curl, server-to-server) sends no Origin and
 * cannot be blocked here. Those are bounded by the rate limiter (lib/ratelimit)
 * and your provider spend caps. This is defence in depth, not a single gate.
 */

function parseAllowed() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalhost(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

/*
 * Decide what to do with a request's Origin header.
 *   ''      → no Origin header (same-origin GET, curl, server-to-server): allow,
 *             nothing to echo.
 *   string  → origin is allowed: echo this exact value in Access-Control-Allow-Origin.
 *   null    → origin is present but NOT allowed: caller should reject (403).
 *
 * `host` is the request Host header; pass it so same-origin requests are
 * recognised without any configuration.
 */
function resolveOrigin(origin, host) {
  if (!origin) return '';

  // 1) Same-origin: Origin's host matches the Host we were served on.
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (host && originHost === String(host).toLowerCase()) return origin;
  } catch { /* malformed Origin header — fall through to the checks below */ }

  // 2) Local development.
  if (isLocalhost(origin)) return origin;

  // 3) Explicitly allowlisted extra origins.
  return parseAllowed().includes(origin) ? origin : null;
}

module.exports = { resolveOrigin };
