/**
 * Test helper: build an isolated, throwaway v1 file set in a temp dir and
 * point the DB/keystore env vars at it. Each call returns a unique dir so
 * tests never share state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempV1 {
  dir: string;
  configPath: string;
  cachePath: string;
  chatPath: string;
  statsPath: string;
}

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-v2-'));
}

/** Writes a minimal-but-representative v1 dataset into a fresh temp dir. */
export function writeV1Fixture(opts?: {
  withKeys?: boolean; // include a provider with a plaintext apiKey + apiKeys pool
  withConnectingKeys?: boolean;
}): TempV1 {
  const dir = makeTempDir();

  const provider = {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    enabled: true,
    apiKey: opts?.withKeys ? 'sk-plaintext-super-secret-value' : '',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://groq.com',
    signupUrl: 'https://console.groq.com/keys',
    creditsDescription: 'Fast inference',
    limitsDescription: '60 RPM',
    models: [
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
    ],
    limits: { rpm: 60, rpd: null, tpm: null, tpd: null, concurrent: 4 },
  };
  if (opts?.withConnectingKeys) {
    (provider as Record<string, unknown>).apiKeys = [
      { id: 'k1', key: 'pk-a', weight: 2, enabled: true },
      { id: 'k2', key: 'pk-b', weight: 1, enabled: true },
    ];
  }

  const config = {
    globalProxy: '',
    globalProxyEnabled: false,
    rateLimitQueueEnabled: true,
    rateLimitQueueTimeoutMs: 180000,
    providers: [provider],
    virtualModels: [
      {
        id: 'coding-agent',
        name: 'Coding Agent Pool',
        strategy: 'priority',
        config: { maxRetries: 1, timeoutMs: 30000, cooldownMs: 60000, fallbackOn5xx: true, fallbackOn429: true, fallbackOn403: true },
        targets: [{ providerId: 'groq', modelId: 'llama-3.1-8b-instant' }],
      },
    ],
    aliases: {},
    semanticCacheEnabled: true,
    semanticCacheThreshold: 0.92,
    virtualKeys: [
      { id: 'vk-1', enabled: true, limits: { rpm: 10, rpd: 100 }, usage: { requests: [1700000000000, 1700000010000], tokens: 500 } },
    ],
    stats: { totalRequests: 4, successfulRequests: 3, failedRequests: 1, tokensSaved: 0, approximateCostSaved: 0 },
    someFutureVersionField: { note: 'preserve me' },
  };

  const cache = [
    { id: 'cache-1700000000000-abc12', prompt: 'Hello world', completion: '{"choices":[{"message":{"content":"hi"}}]}', created_at: 1700000000000 },
    { id: 'cache-1700000000100-def34', prompt: 'Another cached prompt', completion: '{"choices":[{"message":{"content":"hello"}}]}', created_at: 1700000000100 },
  ];

  const chat = {
    sessions: [{ id: 'sess_1', title: 'New Chat', createdAt: '2024-01-01T00:00:00.000Z' }],
    messages: [
      { id: 'msg_1', sessionId: 'sess_1', role: 'user', content: 'hello', steps: [], createdAt: '2024-01-01T00:00:01.000Z' },
      { id: 'orphan_msg', sessionId: 'sess_missing', role: 'assistant', content: 'orphan', steps: [{ label: 'step' }], createdAt: '2024-01-01T00:00:02.000Z' },
    ],
  };

  const statsHistory = [
    { timestamp: '2024-01-01T00:00:00.000Z', totalRequests: 3, successfulRequests: 2 },
    { timestamp: '2024-01-02T00:00:00.000Z', totalRequests: 5, successfulRequests: 5 },
  ];

  const p = (f: string) => path.join(dir, f);
  fs.writeFileSync(p('config.json'), JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(p('cache.json'), JSON.stringify(cache, null, 2), 'utf8');
  fs.writeFileSync(p('chat-sessions.json'), JSON.stringify(chat, null, 2), 'utf8');
  fs.writeFileSync(p('stats-history.json'), JSON.stringify(statsHistory, null, 2), 'utf8');

  return {
    dir,
    configPath: p('config.json'),
    cachePath: p('cache.json'),
    chatPath: p('chat-sessions.json'),
    statsPath: p('stats-history.json'),
  };
}

export function setEnvForDb(dir: string): void {
  process.env.GATEWAY_DB_PATH = path.join(dir, 'gateway.db');
  process.env.GATEWAY_DATA_DIR = dir;
  process.env.GATEWAY_MASTER_KEY_PATH = path.join(dir, '.gateway-master-key');
}