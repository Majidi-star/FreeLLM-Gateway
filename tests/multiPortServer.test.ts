import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, getActiveEndpointsService } from '../src/api/server.js';
import { resetConfigForTest, getConfig } from '../src/infra/config.js';
import { closeDatabase } from '../src/infra/db/client.js';
import { translateAnthropicToOpenAI, translateOpenAIToAnthropic } from '../src/domain/translation/anthropicProtocol.js';
import type { OpenAIChatResponse } from '../src/domain/translation/types.js';

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine free port')));
      }
    });
    server.on('error', reject);
  });
}

function tcpFetchRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false); // still bound
    });
    socket.once('error', () => {
      resolve(true); // connection refused → port closed
    });
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goalroute-multiport-'));
let openaiPort = 0;
let anthropicPort = 0;
let mcpPort = 0;
let nativePort = 0;

let adminToken = '';

beforeAll(async () => {
  openaiPort = await findFreePort();
  anthropicPort = await findFreePort();
  mcpPort = await findFreePort();
  nativePort = await findFreePort();

  resetConfigForTest({
    NODE_ENV: 'development',
    DATABASE_PATH: path.join(tmpDir, 'test.db'),
    PORT: nativePort,
    PORT_OPENAI: openaiPort,
    PORT_ANTHROPIC: anthropicPort,
    PORT_MCP: mcpPort,
  });
  process.env.ALLOW_ANONYMOUS_DEV = 'true';
  adminToken = getConfig().ADMIN_API_TOKEN;
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Anthropic protocol payload transformation', () => {
  it('maps Anthropic Messages request to the internal OpenAI request shape', () => {
    const openaiRequest = translateAnthropicToOpenAI({
      model: 'test-model',
      system: 'You are helpful.',
      max_tokens: 128,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      ],
    });

    expect(openaiRequest.model).toBe('test-model');
    expect(openaiRequest.max_tokens).toBe(128);
    expect(openaiRequest.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('maps an OpenAI chat completion to a real Anthropic Messages response', () => {
    const openaiResponse: OpenAIChatResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'routed-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Answer text' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    };

    const anthropicResponse = translateOpenAIToAnthropic(openaiResponse, 'claude-requested');
    expect(anthropicResponse).toEqual({
      id: 'chatcmpl-123',
      type: 'message',
      role: 'assistant',
      model: 'claude-requested',
      content: [{ type: 'text', text: 'Answer text' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 7 },
    });
  });
});

interface InjectResult {
  statusCode: number;
  json: () => unknown;
}

interface TestApp {
  inject: (opts: Record<string, unknown>) => Promise<InjectResult>;
  close: () => Promise<void>;
}

const appHolder = globalThis as Record<string, unknown>;

function getApp(): TestApp {
  return appHolder.__multiportApp as TestApp;
}

describe('Multi-Port Gateway Server (live bindings)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = (await buildApp()) as unknown as TestApp;
    await getActiveEndpointsService().startAll();
    appHolder.__multiportApp = app;
  });

  afterAll(async () => {
    await getActiveEndpointsService().stopAll();
    await app.close();
  });

  it('serves OpenAI-compatible payloads on the dedicated OpenAI port', async () => {
    const res = await fetch(`http://127.0.0.1:${openaiPort}/v1/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: Array<{ id: string; object: string }> };
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].object).toBe('model');
  });

  it('serves Anthropic-compatible payloads on the dedicated Anthropic port', async () => {
    const res = await fetch(`http://127.0.0.1:${anthropicPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    // With no routing pools configured, the translated dispatch fails with NO_ACTIVE_POOLS —
    // proving the request passed the Anthropic translation layer and reached the gateway.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NO_ACTIVE_POOLS');
  });

  it('serves the native gateway health route on the native port', async () => {
    const res = await fetch(`http://127.0.0.1:${nativePort}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('re-binds the OpenAI port dynamically and closes the old port', async () => {
    const newOpenaiPort = await findFreePort();

    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ports: { openai: newOpenaiPort } },
    });
    expect(res.statusCode).toBe(200);

    const status = res.json() as { endpoints: Record<string, { port: number }> };
    expect(status.endpoints.openai.port).toBe(newOpenaiPort);

    // Old port must be closed.
    expect(await tcpFetchRefused(openaiPort)).toBe(true);

    // New port must serve OpenAI traffic.
    const modelsRes = await fetch(`http://127.0.0.1:${newOpenaiPort}/v1/models`);
    expect(modelsRes.status).toBe(200);

    openaiPort = newOpenaiPort;
  });

  it('rolls back to the previous binding when the new port is occupied', async () => {
    // Occupy a port with an unrelated server so binding fails.
    const blocker = net.createServer();
    const blockedPort = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        const addr = blocker.address();
        resolve(addr && typeof addr === 'object' ? addr.port : 0);
      });
    });

    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ports: { anthropic: blockedPort } },
    });
    expect(res.statusCode).toBe(409);
    const errBody = res.json() as { error: { code: string } };
    expect(errBody.error.code).toBe('PORT_BIND_FAILED');

    // Original Anthropic binding must be restored and serving again.
    const retry = await fetch(`http://127.0.0.1:${anthropicPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }),
    });
    expect(retry.status).toBe(400);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it('toggles host binding between 127.0.0.1 and 0.0.0.0 with state persistence', async () => {
    const remoteRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { remoteAccessEnabled: true },
    });
    expect(remoteRes.statusCode).toBe(200);
    let status = remoteRes.json() as {
      host: string;
      remoteAccessEnabled: boolean;
      endpoints: Record<string, { port: number }>;
    };
    expect(status.host).toBe('0.0.0.0');
    expect(status.remoteAccessEnabled).toBe(true);

    // Loopback still reaches the re-bound listener.
    const remoteCheck = await fetch(`http://127.0.0.1:${openaiPort}/v1/models`, {
      headers: { connection: 'close' },
    });
    expect(remoteCheck.status).toBe(200);

    const localRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { remoteAccessEnabled: false },
    });
    expect(localRes.statusCode).toBe(200);
    status = localRes.json() as typeof status;
    expect(status.host).toBe('127.0.0.1');
    expect(status.remoteAccessEnabled).toBe(false);

    const localCheck = await fetch(`http://127.0.0.1:${openaiPort}/v1/models`, {
      headers: { connection: 'close' },
    });
    expect(localCheck.status).toBe(200);
  });

  it('allows unauthenticated GET /api/v1/system/endpoints status read even with invalid auth header', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: '/api/v1/system/endpoints',
      headers: { authorization: 'Bearer invalid_stale_token_123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host).toBeDefined();
    expect(body.endpoints).toBeDefined();
  });

  it('rejects unauthenticated POST /api/v1/system/endpoints modification with 401', async () => {
    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      payload: { remoteAccessEnabled: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects duplicate port assignment across enabled protocols', async () => {
    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/system/endpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ports: { mcp: openaiPort } },
    });
    expect(res.statusCode).toBe(400);
    const errBody = res.json() as { error: { code: string } };
    expect(errBody.error.code).toBe('VALIDATION_ERROR');
  });
});

