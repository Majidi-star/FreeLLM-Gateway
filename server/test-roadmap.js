import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const CACHE_PATH = path.join(__dirname, 'cache.json');

// Helpers to load/save config
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

async function runTests() {
  console.log('=== Starting LLM Free Pool Gateway Integration Tests ===\n');

  // 1. Backup Config and Cache
  const configBackup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  const cacheBackup = fs.existsSync(CACHE_PATH) ? fs.readFileSync(CACHE_PATH, 'utf8') : null;

  let childServer = null;

  try {
    // 2. Prepare Test Data
    const testConfig = configBackup ? JSON.parse(configBackup) : {};
    testConfig.semanticCacheEnabled = true;
    testConfig.semanticCacheThreshold = 0.90;
    testConfig.aliases = {
      'gpt-4-alias-test': 'fast-flash'
    };
    testConfig.virtualKeys = [
      {
        id: 'sk-gw-test-token-123',
        name: 'Integration Test Key',
        enabled: true,
        limits: { rpm: 2, rpd: 10 },
        usage: { requests: [] }
      }
    ];
    saveConfig(testConfig);
    console.log('[1/5] Seeded config.json with Virtual Key, Model Alias and Cache enabled.');

    // Seed cache.json with test completions
    const testCache = [
      {
        id: 'cache-test-123',
        prompt: 'test prompt content for caching',
        completion: JSON.stringify({
          id: 'chatcmpl-test-cache-hit',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4-alias-test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'This is a cached semantic response test!' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }),
        created_at: Date.now()
      }
    ];
    fs.writeFileSync(CACHE_PATH, JSON.stringify(testCache, null, 2), 'utf8');
    console.log('[2/5] Seeded cache.json with a test prompt completion entry.');

    // 3. Spawn server child process (temporarily override port to 3005 to avoid collisions)
    console.log('[3/5] Spawning gateway server child process on port 3005...');
    childServer = spawn('node', [path.join(__dirname, 'index.js')], {
      env: { ...process.env, PORT: '3005' }
    });

    // Wait for server to boot
    await new Promise((resolve) => {
      childServer.stdout.on('data', (data) => {
        if (data.toString().includes('listening on port 3005')) {
          resolve();
        }
      });
      // Fallback timeout
      setTimeout(resolve, 2000);
    });

    const client = axios.create({
      baseURL: 'http://localhost:3005/v1',
      validateStatus: () => true
    });

    // Test A: Unauthenticated Request
    console.log('\n--- Test A: Unauthenticated Request (Should fail with 401) ---');
    const resA = await client.post('/chat/completions', {
      model: 'fast-flash',
      messages: [{ role: 'user', content: 'test prompt content for caching' }]
    });
    console.log(`Response Status: ${resA.status}`);
    console.log(`Response Body:`, resA.data);
    if (resA.status === 401) {
      console.log('✓ Test A Passed: Correctly blocked request with 401.');
    } else {
      throw new Error('Test A Failed: Server did not return 401.');
    }

    // Test B: Authenticated Cache Hit (Non-Streaming)
    console.log('\n--- Test B: Authenticated Cache Hit (Should return cached content instantly) ---');
    const resB = await client.post('/chat/completions', {
      model: 'gpt-4-alias-test', // requesting the alias model
      messages: [{ role: 'user', content: 'test prompt content for caching' }]
    }, {
      headers: { Authorization: 'Bearer sk-gw-test-token-123' }
    });
    console.log(`Response Status: ${resB.status}`);
    console.log(`Cache Header x-gateway-cache: ${resB.headers['x-gateway-cache']}`);
    console.log(`Response Text: ${resB.data?.choices?.[0]?.message?.content}`);
    if (resB.status === 200 && resB.headers['x-gateway-cache'] === 'hit' && resB.data?.choices?.[0]?.message?.content.includes('cached')) {
      console.log('✓ Test B Passed: Successfully returned non-stream semantic cache hit and processed model alias.');
    } else {
      throw new Error('Test B Failed: Cache hit failed or model alias was not routed.');
    }

    // Test C: Authenticated Cache Hit (Streaming)
    console.log('\n--- Test C: Authenticated Cache Hit (Streaming) ---');
    const resC = await client.post('/chat/completions', {
      model: 'gpt-4-alias-test',
      messages: [{ role: 'user', content: 'test prompt content for caching' }],
      stream: true
    }, {
      headers: { Authorization: 'Bearer sk-gw-test-token-123' },
      responseType: 'stream'
    });
    console.log(`Response Status: ${resC.status}`);
    console.log(`Cache Header: ${resC.headers['x-gateway-cache']}`);
    console.log(`Content-Type: ${resC.headers['content-type']}`);
    
    // Accumulate stream chunks
    let chunks = '';
    await new Promise((resolve) => {
      resC.data.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      resC.data.on('end', resolve);
    });
    console.log(`Received SSE Stream Output:\n${chunks.substring(0, 300)}...`);
    if (chunks.includes('data:') && chunks.includes('[DONE]')) {
      console.log('✓ Test C Passed: Successfully simulated SSE streaming format for cached responses.');
    } else {
      throw new Error('Test C Failed: SSE chunk stream format is invalid.');
    }

    // Test D: Rate Limits (RPM: 2)
    console.log('\n--- Test D: Virtual Key Rate Limiting (Exceeding RPM limit: 2) ---');
    console.log('Sending request #3 (Key limit RPM is 2)...');
    const resD = await client.post('/chat/completions', {
      model: 'gpt-4-alias-test',
      messages: [{ role: 'user', content: 'test prompt content for caching' }]
    }, {
      headers: { Authorization: 'Bearer sk-gw-test-token-123' }
    });
    console.log(`Response Status: ${resD.status}`);
    console.log(`Response Body:`, resD.data);
    if (resD.status === 429) {
      console.log('✓ Test D Passed: Correctly rate-limited virtual key with 429 after exceeding limit.');
    } else {
      throw new Error('Test D Failed: Server did not return 429 on rate limit breach.');
    }

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err.message);
  } finally {
    // 4. Terminate Child Server
    if (childServer) {
      console.log('\nStopping child server...');
      childServer.kill();
    }

    // 5. Restore backup config and cache
    console.log('=== Cleanup and Restoring Original Database State ===');
    if (configBackup) {
      fs.writeFileSync(CONFIG_PATH, configBackup, 'utf8');
      console.log('Restored config.json database backup.');
    }
    if (cacheBackup) {
      fs.writeFileSync(CACHE_PATH, cacheBackup, 'utf8');
    } else {
      if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
    }
    console.log('Restored cache.json backup. Done.');
  }
}

runTests();
