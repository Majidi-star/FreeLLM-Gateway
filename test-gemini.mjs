import axios from 'axios';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const config = JSON.parse(readFileSync('./config.json', 'utf8'));
const gemini = config.providers.find(p => p.id === 'gemini');
const apiKey = gemini.apiKey;
const baseUrl = gemini.baseUrl;

console.log('Stored baseUrl:', baseUrl);
console.log('API Key prefix:', apiKey.substring(0, 8) + '...');

const testModel = 'gemini-3.5-flash-lite';
const correctUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const routerLogic = (() => {
  let base = baseUrl;
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (base.endsWith('/models')) base = base.substring(0, base.length - 7);
  if (base.endsWith('/openai')) return `${base}/chat/completions`;
  return `${base}/openai/chat/completions`;
})();

console.log('\nURL that router.js would generate:', routerLogic);
console.log('Correct URL:', correctUrl);

// Test correct URL 
console.log('\n--- Testing correct URL ---');
try {
  const r = await axios.post(correctUrl, {
    model: testModel,
    messages: [{ role: 'user', content: 'Say hi in one word' }],
    max_tokens: 10,
    stream: false
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  console.log('SUCCESS:', JSON.stringify(r.data).substring(0, 400));
} catch (e) {
  console.error('ERROR status:', e.response?.status);
  console.error('ERROR data:', JSON.stringify(e.response?.data).substring(0, 600));
}

// Test what router actually generates
if (routerLogic !== correctUrl) {
  console.log('\n--- Testing URL that router generates (possibly wrong) ---');
  try {
    const r = await axios.post(routerLogic, {
      model: testModel,
      messages: [{ role: 'user', content: 'Say hi in one word' }],
      max_tokens: 10,
      stream: false
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    console.log('SUCCESS:', JSON.stringify(r.data).substring(0, 400));
  } catch (e) {
    console.error('ERROR status:', e.response?.status);
    console.error('ERROR data:', JSON.stringify(e.response?.data).substring(0, 600));
  }
} else {
  console.log('\nRouter URL matches correct URL - no double-openai bug with current config.');
}
