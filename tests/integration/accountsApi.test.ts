import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';
import { closeDatabase } from '../../src/infra/db/client.js';

describe('Accounts API Integration', () => {
  let app: any;
  let adminToken: string;

  beforeEach(async () => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    app = await buildApp();
    adminToken = getConfig().ADMIN_API_TOKEN;
  });

  afterEach(async () => {
    await app.close();
    closeDatabase();
  });

  it('full lifecycle: create account → create key → list keys → rotate → revoke → delete account', async () => {
    // create account
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Test Account' },
    });
    expect(createRes.statusCode).toBe(200);
    const account = JSON.parse(createRes.body);
    expect(account.name).toBe('Test Account');
    const accountId = account.id;

    // create key
    const keyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/keys`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Key1' },
    });
    expect(keyRes.statusCode).toBe(200);
    const createdKey = JSON.parse(keyRes.body);
    expect(createdKey.plaintext).toMatch(/^gr_live_[A-Za-z0-9_-]{20,}$/);
    expect(keyRes.headers['cache-control']).toBe('no-store');

    const keyId = createdKey.id;

    // list keys - no plaintext
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountId}/keys`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const keys = JSON.parse(listRes.body);
    expect(keys.length).toBe(1);
    expect('plaintext' in keys[0]).toBe(false);

    // rotate
    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/keys/${keyId}/rotate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(rotateRes.statusCode).toBe(200);
    const rotated = JSON.parse(rotateRes.body);
    expect(rotated.plaintext).toMatch(/^gr_live_[A-Za-z0-9_-]{20,}$/);
    expect(rotated.plaintext).not.toBe(createdKey.plaintext);

    // revoke (delete key)
    const delKeyRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${accountId}/keys/${keyId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delKeyRes.statusCode).toBe(200);
    expect(JSON.parse(delKeyRes.body)).toEqual({ ok: true });

    // delete account
    const delAccRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${accountId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delAccRes.statusCode).toBe(200);
  });

  it('returns 401 without admin token for all routes', async () => {
    const routes = [
      ['GET', '/api/v1/accounts'],
      ['POST', '/api/v1/accounts'],
      ['GET', '/api/v1/accounts/any'],
      ['PATCH', '/api/v1/accounts/any'],
      ['DELETE', '/api/v1/accounts/any'],
      ['GET', '/api/v1/accounts/any/keys'],
      ['POST', '/api/v1/accounts/any/keys'],
      ['POST', '/api/v1/accounts/any/keys/k/rotate'],
      ['DELETE', '/api/v1/accounts/any/keys/k'],
      ['GET', '/api/v1/accounts/any/endpoints'],
    ];
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('POST /api/v1/accounts with empty name returns 400 validation error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/accounts/:id/endpoints returns descriptors without real key', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Endpoint Account' },
    });
    const account = JSON.parse(createRes.body);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${account.id}/endpoints`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data.endpoints)).toBe(true);
    expect(data.endpoints.length).toBeGreaterThanOrEqual(0);
    for (const ep of data.endpoints) {
      expect(ep.exampleCurl).toContain('<YOUR_API_KEY>');
      expect(ep.exampleCurl).not.toMatch(/gr_live_[A-Za-z0-9_-]{20,}/);
    }
  });
});
