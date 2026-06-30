'use strict';

/*
 * IBM watsonx.ai — Granite chat helper.
 *
 * Handles the two-step watsonx flow:
 *   1. Exchange the IBM Cloud API key for a short-lived IAM bearer token
 *      (cached in memory and refreshed ~5 min before it expires).
 *   2. POST the conversation to the watsonx /ml/v1/text/chat endpoint.
 *
 * watsonx already returns an OpenAI-shaped body
 * ({ choices: [{ message: { content } }] }), so the frontend's existing
 * parser works unchanged.
 *
 * Required environment variables:
 *   WATSONX_API_KEY     — IBM Cloud API key
 *   WATSONX_PROJECT_ID  — watsonx project ID
 *   WATSONX_URL         — region endpoint, e.g. https://us-south.ml.cloud.ibm.com
 *   WATSONX_MODEL_ID    — (optional) Granite model id; defaults below
 */

const DEFAULT_MODEL = 'ibm/granite-3-8b-instruct';
const CHAT_API_VERSION = '2024-05-31';

let cachedToken = null;
let tokenExpiry = 0;

async function getIamToken(apiKey) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: apiKey,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.errorMessage || 'Failed to obtain IBM IAM token.');
  }

  cachedToken = json.access_token;
  // expires_in is in seconds (typically 3600); refresh 5 minutes early.
  tokenExpiry = now + (((json.expires_in || 3600) - 300) * 1000);
  return cachedToken;
}

/*
 * Send a chat conversation to Granite via watsonx.
 * Returns { ok, status, data } where `data` is OpenAI-shaped on success,
 * or { error: { message } } on failure.
 */
async function watsonxChat({ messages, maxTokens = 900, temperature = 0.7 }) {
  const apiKey    = process.env.WATSONX_API_KEY;
  const projectId = process.env.WATSONX_PROJECT_ID;
  const baseUrl   = process.env.WATSONX_URL;
  const modelId   = process.env.WATSONX_MODEL_ID || DEFAULT_MODEL;

  if (!apiKey || !projectId || !baseUrl) {
    return {
      ok: false,
      status: 500,
      data: { error: { message: 'Server misconfigured: missing WATSONX_API_KEY, WATSONX_PROJECT_ID, or WATSONX_URL.' } },
    };
  }

  let token;
  try {
    token = await getIamToken(apiKey);
  } catch (e) {
    return { ok: false, status: 502, data: { error: { message: e.message } } };
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/ml/v1/text/chat?version=${CHAT_API_VERSION}`;

  // The free Granite plan caps *concurrent* requests for the model (shared
  // across all free-tier users), returning 429 when every slot is busy. A slot
  // usually frees within a few seconds, so transparently retry a few times with
  // backoff before giving up — this turns most "Buddy is catching up" misses
  // into a slightly slower success.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRY_DELAYS_MS = [1500, 3000, 5000]; // 3 retries → ~9.5s worst case

  let upstream, json;
  for (let attempt = 0; ; attempt++) {
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_id:    modelId,
          project_id:  projectId,
          messages,
          max_tokens:  maxTokens,
          temperature,
        }),
      });
      json = await upstream.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, status: 502, data: { error: { message: e.message } } };
    }

    // Retry only on 429 (concurrency limit) or 503 (temporarily unavailable),
    // and only while we still have a delay budget left.
    const transient = upstream.status === 429 || upstream.status === 503;
    if (transient && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    break;
  }

  if (!upstream.ok) {
    const msg =
      (json && (json.errors?.[0]?.message || json.error?.message || json.message)) ||
      `watsonx request failed (${upstream.status}).`;
    return { ok: false, status: upstream.status, data: { error: { message: msg } } };
  }

  // Success — watsonx returns { choices: [{ message: { content } }] }.
  return { ok: true, status: 200, data: json };
}

module.exports = { watsonxChat };
