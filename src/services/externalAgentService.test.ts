import { describe, it, expect } from 'vitest';
import {
  resolveExternalProtocol,
  normalizeExternalBaseUrl,
} from './externalAgentService.js';

describe('ExternalAgentService Helpers', () => {
  describe('resolveExternalProtocol', () => {
    it('should respect explicitly requested protocol', () => {
      expect(resolveExternalProtocol('http://localhost:11434/v1', 'llama3', 'anthropic')).toBe('anthropic');
      expect(resolveExternalProtocol('https://api.openai.com', 'gpt-4o', 'gemini')).toBe('gemini');
    });

    it('should auto-detect Anthropic for native Anthropic URL', () => {
      expect(resolveExternalProtocol('https://api.anthropic.com', 'claude-3-5-sonnet', 'auto')).toBe('anthropic');
      // Custom proxy URLs default to OpenAI-compatible protocol to prevent proxy protocol mismatch
      expect(resolveExternalProtocol('http://custom-proxy.internal', 'claude-3-opus', 'auto')).toBe('openai');
      expect(resolveExternalProtocol('http://custom-proxy.internal', 'claude-3-opus', 'anthropic')).toBe('anthropic');
    });

    it('should auto-detect Gemini for native Gemini URL', () => {
      expect(
        resolveExternalProtocol('https://generativelanguage.googleapis.com', 'gemini-1.5-pro', 'auto')
      ).toBe('gemini');
      // Custom proxy URLs default to OpenAI-compatible protocol
      expect(resolveExternalProtocol('http://my-proxy', 'gemini-flash', 'auto')).toBe('openai');
      expect(resolveExternalProtocol('http://my-proxy', 'gemini-flash', 'gemini')).toBe('gemini');
    });

    it('should default to OpenAI protocol', () => {
      expect(resolveExternalProtocol('http://localhost:11434/v1', 'llama3.2', 'auto')).toBe('openai');
      expect(resolveExternalProtocol('https://api.groq.com/openai/v1', 'llama-3.1-70b', 'auto')).toBe('openai');
    });
  });

  describe('normalizeExternalBaseUrl', () => {
    it('should handle empty or default URLs', () => {
      expect(normalizeExternalBaseUrl('', 'openai')).toBe('http://localhost:11434/v1');
      expect(normalizeExternalBaseUrl('', 'anthropic')).toBe('https://api.anthropic.com');
      expect(normalizeExternalBaseUrl('', 'gemini')).toBe('https://generativelanguage.googleapis.com');
    });

    it('should add missing http protocol prefix', () => {
      expect(normalizeExternalBaseUrl('localhost:11434/v1', 'openai')).toBe('http://localhost:11434/v1');
    });

    it('should strip trailing endpoints cleanly', () => {
      expect(normalizeExternalBaseUrl('http://localhost:11434/v1/chat/completions', 'openai')).toBe(
        'http://localhost:11434/v1'
      );
      expect(normalizeExternalBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
        'https://api.anthropic.com'
      );
    });
  });
});
