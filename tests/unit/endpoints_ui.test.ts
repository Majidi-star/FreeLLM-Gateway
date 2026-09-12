globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  clear: () => {},
  removeItem: () => {},
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  clear: () => {},
  removeItem: () => {},
};

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAdminToken, DEFAULT_FALLBACK_STATUS } from '../../src/web/components/settings/EndpointsManager.js';

describe('EndpointsManager Token Resolution', () => {
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocalStorage = globalThis.localStorage;
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = Object.getOwnPropertyDescriptor(import.meta, 'env');
    globalThis.sessionStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
    };
    globalThis.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.localStorage = originalLocalStorage;
    if (originalEnv) {
      Object.defineProperty(import.meta, 'env', originalEnv);
    }
  });

  it('returns sessionStorage token when available', () => {
    (globalThis.sessionStorage.getItem as any).mockReturnValue('session-token');
    expect(getAdminToken()).toBe('session-token');
  });

  it('falls back to localStorage when sessionStorage is empty', () => {
    (globalThis.sessionStorage.getItem as any).mockReturnValue(null);
    (globalThis.localStorage.getItem as any).mockReturnValue('local-token');
    expect(getAdminToken()).toBe('local-token');
  });

  it('falls back to import.meta.env.VITE_ADMIN_API_TOKEN when storages are empty', () => {
    (globalThis.sessionStorage.getItem as any).mockReturnValue(null);
    (globalThis.localStorage.getItem as any).mockReturnValue(null);
    // import.meta.env is resolved at transform time in vitest; verify it resolves
    // to whatever is defined in import.meta.env (may be set via vitest config or .env)
    const envToken = (import.meta as any).env?.VITE_ADMIN_API_TOKEN;
    if (envToken) {
      expect(getAdminToken()).toBe(envToken);
    } else {
      // If no env token is configured, falls through to default
      expect(getAdminToken()).toBe('dev-admin-secret-token');
    }
  });

  it('falls back to dev-admin-secret-token when all sources are empty', () => {
    (globalThis.sessionStorage.getItem as any).mockReturnValue(null);
    (globalThis.localStorage.getItem as any).mockReturnValue(null);
    // When sessionStorage and localStorage both return null, and env is not set,
    // the function falls through to the hardcoded default
    const envToken = (import.meta as any).env?.VITE_ADMIN_API_TOKEN;
    if (!envToken) {
      expect(getAdminToken()).toBe('dev-admin-secret-token');
    } else {
      // If env is set at transform time, it resolves to that
      expect(getAdminToken()).toBe(envToken);
    }
  });

  it('resolution order: sessionStorage > localStorage > env > default', () => {
    (globalThis.sessionStorage.getItem as any).mockReturnValue('session-token');
    (globalThis.localStorage.getItem as any).mockReturnValue('local-token');
    // sessionStorage takes highest priority regardless of env
    expect(getAdminToken()).toBe('session-token');
  });
});

describe('DEFAULT_FALLBACK_STATUS', () => {
  it('contains valid default port 8787 for native endpoint', () => {
    expect(DEFAULT_FALLBACK_STATUS.endpoints.native.port).toBe(8787);
    expect(DEFAULT_FALLBACK_STATUS.endpoints.native.enabled).toBe(true);
  });

  it('contains valid default port 8788 for openai endpoint', () => {
    expect(DEFAULT_FALLBACK_STATUS.endpoints.openai.port).toBe(8788);
    expect(DEFAULT_FALLBACK_STATUS.endpoints.openai.enabled).toBe(true);
  });

  it('contains valid default port 8789 for anthropic endpoint', () => {
    expect(DEFAULT_FALLBACK_STATUS.endpoints.anthropic.port).toBe(8789);
    expect(DEFAULT_FALLBACK_STATUS.endpoints.anthropic.enabled).toBe(true);
  });

  it('contains valid default port 8790 for mcp endpoint', () => {
    expect(DEFAULT_FALLBACK_STATUS.endpoints.mcp.port).toBe(8790);
    expect(DEFAULT_FALLBACK_STATUS.endpoints.mcp.enabled).toBe(true);
  });

  it('contains a host definition', () => {
    expect(DEFAULT_FALLBACK_STATUS.host).toBeDefined();
    expect(typeof DEFAULT_FALLBACK_STATUS.host).toBe('string');
    expect(DEFAULT_FALLBACK_STATUS.host.length).toBeGreaterThan(0);
  });

  it('has all four protocol endpoints defined', () => {
    const protocols = Object.keys(DEFAULT_FALLBACK_STATUS.endpoints);
    expect(protocols).toContain('native');
    expect(protocols).toContain('openai');
    expect(protocols).toContain('anthropic');
    expect(protocols).toContain('mcp');
    expect(protocols.length).toBe(4);
  });

  it('has correct path prefixes for all endpoints', () => {
    expect(DEFAULT_FALLBACK_STATUS.endpoints.native.pathPrefix).toBe('/api/v1');
    expect(DEFAULT_FALLBACK_STATUS.endpoints.openai.pathPrefix).toBe('/v1');
    expect(DEFAULT_FALLBACK_STATUS.endpoints.anthropic.pathPrefix).toBe('/v1');
    expect(DEFAULT_FALLBACK_STATUS.endpoints.mcp.pathPrefix).toBe('/mcp');
  });
});
