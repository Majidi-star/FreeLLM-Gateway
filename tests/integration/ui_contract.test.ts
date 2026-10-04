import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';
import { FastifyInstance } from 'fastify';

describe('UI Contract Real-Server Integration Test', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    adminToken = getConfig().ADMIN_API_TOKEN;
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies account creation, key creation with plaintext key and pool pinning validation', async () => {
    // 1. Create Account
    const accRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'UI Test Account', description: 'Testing UI payloads' },
    });
    expect(accRes.statusCode).toBe(200);
    const account = JSON.parse(accRes.body);
    expect(account.id).toBeDefined();

    // 2. Attempt Key Creation with non-existent poolId / pinnedPoolId -> Should return 400
    const invalidPoolRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${account.id}/keys`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Key With Invalid Pool', pinnedPoolId: 'non-existent-pool-xyz' },
    });
    expect(invalidPoolRes.statusCode).toBe(400);

    // 3. Create key with UI-shaped payload sending pinnedPoolId
    const keyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${account.id}/keys`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'UI Created Key', pinnedPoolId: null },
    });
    expect(keyRes.statusCode).toBe(200);
    const keyResult = JSON.parse(keyRes.body);
    expect(keyResult.plaintext).toBeDefined();
    expect(keyResult.key).toBeDefined();
    expect(keyResult.key).toBe(keyResult.plaintext);
    expect(keyResult.plaintext.startsWith('gr_live_')).toBe(true);
  });
});
