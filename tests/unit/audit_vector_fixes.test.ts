import { describe, it, expect, vi } from 'vitest';
import { sanitizeForClipboard } from '../../src/web/utils/clipboardSanitizer.js';
import { GatewayService } from '../../src/services/gatewayService.js';

describe('Vector 3 & Vector 1 Audit Fixes', () => {
  describe('Clipboard Bidi & Unicode Sanitizer (Vector 3)', () => {
    it('strips Bidi overrides and zero-width characters, normalizes CRLF and trims trailing whitespace', () => {
      const input = 'Hello\u200EWorld\u202ARoute\u200BTest\r\nLine 2  \r\n  ';
      const output = sanitizeForClipboard(input);
      expect(output).toBe('HelloWorldRouteTest\nLine 2');
    });

    it('handles empty string gracefully', () => {
      expect(sanitizeForClipboard('')).toBe('');
    });
  });

  describe('Strictly Incrementing SSE Timestamps (Vector 1)', () => {
    it('ensures timestamps strictly increment during same-millisecond burst logs', () => {
      const mockPoolRepo = {} as any;
      const mockConnRepo = {} as any;
      const mockModelRepo = {} as any;
      const mockProvRepo = {} as any;
      const mockHealthRepo = {} as any;
      const mockQuotaRepo = {} as any;
      const mockLogRepo = {} as any;

      const gateway = new GatewayService(
        mockPoolRepo,
        mockConnRepo,
        mockModelRepo,
        mockProvRepo,
        mockHealthRepo,
        mockQuotaRepo,
        mockLogRepo
      );

      const timestamps: number[] = [];
      gateway.on('log', (payload) => {
        timestamps.push(payload.timestamp);
      });

      // Freeze Date.now() to return fixed timestamp
      const fixedTime = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      // Emit 5 log events in the same millisecond
      for (let i = 0; i < 5; i++) {
        (gateway as any).emitLogEvent({
          traceId: `tr-${i}`,
          timestamp: fixedTime,
          clientName: 'test',
          provider: 'prov',
          model: 'mdl',
          tokens: { prompt: 10, completion: 10, total: 20 },
          latencyMs: 50,
          isFallback: false,
          candidateTrace: [],
        });
      }

      expect(timestamps).toHaveLength(5);
      expect(timestamps[0]).toBe(fixedTime);
      expect(timestamps[1]).toBe(fixedTime + 1);
      expect(timestamps[2]).toBe(fixedTime + 2);
      expect(timestamps[3]).toBe(fixedTime + 3);
      expect(timestamps[4]).toBe(fixedTime + 4);

      vi.restoreAllMocks();
    });
  });
});
