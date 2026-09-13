import { describe, it, expect } from 'vitest';
import { MultiPortServerService } from '../../src/services/multiPortServerService.js';
import { ValidationError } from '../../src/shared/errors.js';

describe('MultiPortServerService remote-access guard', () => {
  it('rejects enabling remote access while the admin token is still the default', async () => {
    const svc = new MultiPortServerService({
      buildProtocolApp: async () => {
        throw new Error('should not be called in this test');
      },
      initialPorts: { native: 1, openai: 2, anthropic: 3, mcp: 4 },
      initialHost: '127.0.0.1',
      remoteAccessEnabled: false,
      isDefaultAdminToken: true,
      initialEnabled: { native: true, openai: false, anthropic: false, mcp: false },
    });

    await expect(svc.updateConfig({ remoteAccessEnabled: true })).rejects.toThrow(ValidationError);
  });
});
