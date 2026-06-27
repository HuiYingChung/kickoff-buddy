// Standalone watsonx connectivity test.
// Run from the project root:  node test-watsonx.js
// It loads .env, gets an IAM token, then calls Granite once and prints the
// FULL result so we can see exactly what (if anything) is failing.

'use strict';
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const API_KEY    = process.env.WATSONX_API_KEY;
const PROJECT_ID = process.env.WATSONX_PROJECT_ID;
const URL        = process.env.WATSONX_URL;
const MODEL_ID   = process.env.WATSONX_MODEL_ID || 'ibm/granite-3-8b-instruct';

function mask(v) { return v ? `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)` : '[MISSING]'; }

(async () => {
  console.log('\n=== 1. Environment variables ===');
  console.log('WATSONX_API_KEY    :', mask(API_KEY));
  console.log('WATSONX_PROJECT_ID :', PROJECT_ID || '[MISSING]');
  console.log('WATSONX_URL        :', URL || '[MISSING]');
  console.log('WATSONX_MODEL_ID   :', MODEL_ID);

  if (!API_KEY || !PROJECT_ID || !URL) {
    console.log('\n✗ One or more variables are missing from .env. Fix that first.\n');
    return;
  }

  console.log('\n=== 2. Getting IAM token ===');
  let token;
  try {
    const r = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: API_KEY,
      }),
    });
    const j = await r.json().catch(() => ({}));
    console.log('HTTP', r.status);
    if (!r.ok || !j.access_token) {
      console.log('✗ IAM token failed. Body:', JSON.stringify(j, null, 2));
      console.log('\n→ This means the WATSONX_API_KEY is wrong/expired. Recreate it at https://cloud.ibm.com/iam/apikeys\n');
      return;
    }
    token = j.access_token;
    console.log('✓ Got IAM token');
  } catch (e) {
    console.log('✗ Network error contacting IAM:', e.message);
    return;
  }

  console.log('\n=== 3. Calling Granite (watsonx chat) ===');
  const endpoint = `${URL.replace(/\/+$/, '')}/ml/v1/text/chat?version=2024-05-31`;
  console.log('POST', endpoint);
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        model_id: MODEL_ID,
        project_id: PROJECT_ID,
        messages: [{ role: 'user', content: 'Say the single word: ok' }],
        max_tokens: 10,
      }),
    });
    const j = await r.json().catch(() => ({}));
    console.log('HTTP', r.status);
    if (r.ok) {
      console.log('✓ SUCCESS. Granite replied:', j.choices?.[0]?.message?.content);
    } else {
      console.log('✗ watsonx returned an error. FULL body:');
      console.log(JSON.stringify(j, null, 2));
    }
  } catch (e) {
    console.log('✗ Network error contacting watsonx:', e.message);
  }
  console.log('');
})();
