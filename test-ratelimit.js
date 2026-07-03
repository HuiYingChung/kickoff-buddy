'use strict';

// Mock-fetch unit tests for lib/ratelimit.js (zero deps).
//   run:  node test-ratelimit.js
// Exercises the Redis-REST counter, over-limit blocking, fail-degraded paths,
// and the clientIp anti-forgery priority. No real Redis is contacted.

const RL_PATH = require.resolve('./lib/ratelimit.js');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log('  FAIL:', n)); };

// Load a fresh copy of the module under a given env (it reads env at load time).
function loadFresh(env) {
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL_ENV', 'KB_RL_MAX', 'KB_RL_WINDOW_SEC']) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  delete require.cache[RL_PATH];
  return require('./lib/ratelimit.js');
}

(async () => {
  // ---- configured: counting + over-limit ----
  let count = 0, shouldThrow = false;
  global.fetch = async () => {
    if (shouldThrow) throw new Error('network down');
    count++; // one pipeline (INCR, EXPIRE, TTL) per checkRateLimit call
    return { ok: true, json: async () => [{ result: count }, { result: 1 }, { result: 3600 }] };
  };

  const { checkRateLimit, clientIp, MAX_HITS } = loadFresh({
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'faketoken',
    KB_RL_MAX: '30', KB_RL_WINDOW_SEC: '3600',
  });
  ok('MAX_HITS default 30', MAX_HITS === 30);

  const req = { headers: { 'x-real-ip': '203.0.113.7' } };
  const results = [];
  for (let i = 1; i <= 32; i++) results.push(await checkRateLimit(req));
  ok('reqs 1-30 allowed', results.slice(0, 30).every(r => r.allowed === true));
  ok('req 31 blocked (count > MAX_HITS)', results[30].allowed === false);
  ok('req 32 blocked', results[31].allowed === false);
  ok('block carries a message', typeof results[30].message === 'string' && results[30].message.length > 0);
  ok('allowed carries remaining', results[0].remaining === 29);

  // ---- backend error -> fail-degraded (blocked, not fail-open) ----
  shouldThrow = true;
  const errRes = await checkRateLimit(req);
  ok('backend error -> fail-degraded (not allowed)', errRes.allowed === false);
  shouldThrow = false;

  // ---- clientIp priority (kickoff-buddy intentionally ignores x-forwarded-for) ----
  ok('clientIp prefers x-real-ip over forged XFF',
    clientIp({ headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } }) === '1.2.3.4');
  ok('clientIp uses x-vercel-forwarded-for when no x-real-ip',
    clientIp({ headers: { 'x-vercel-forwarded-for': '5.6.7.8' } }) === '5.6.7.8');
  ok('clientIp IGNORES forgeable x-forwarded-for, falls to socket',
    clientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } }) === '10.0.0.1');
  ok('clientIp -> unknown when nothing available', clientIp({ headers: {} }) === 'unknown');

  // ---- unconfigured in PRODUCTION -> fail-degraded, must NOT call out ----
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true, json: async () => [] }; };
  const prod = loadFresh({ VERCEL_ENV: 'production' }); // no Redis env
  const prodRes = await prod.checkRateLimit({ headers: { 'x-real-ip': '1.1.1.1' } });
  ok('unconfigured + production -> not allowed (fail-degraded)', prodRes.allowed === false);
  ok('unconfigured + production -> never touched the network', fetched === false);

  // ---- unconfigured in DEV -> pass through (local testing / proxy.js) ----
  const dev = loadFresh({}); // no Redis, no VERCEL_ENV
  const devRes = await dev.checkRateLimit({ headers: { 'x-real-ip': '1.1.1.1' } });
  ok('unconfigured + dev -> allowed (pass through)', devRes.allowed === true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
