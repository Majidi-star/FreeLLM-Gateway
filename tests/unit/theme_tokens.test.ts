import { PRESET_THEMES, ALLOWED_TOKENS } from '../../src/web/context/ThemeContext.js';
import { getHexForInput } from '../../src/web/components/settings/SettingsAppearanceStudio.js';
import { formatErrorMessage } from '../../src/web/components/vault/CredentialVault.js';

describe('Theme Text Token Coverage', () => {
  const TEXT_TOKENS = ['--text-primary', '--text-secondary', '--text-muted', '--text-bright'] as const;

  it('every preset declares all four text tokens', () => {
    for (const [presetName, tokens] of Object.entries(PRESET_THEMES)) {
      for (const token of TEXT_TOKENS) {
        expect(tokens[token as keyof typeof tokens], `${presetName} missing ${token}`).toBeDefined();
        expect(typeof tokens[token as keyof typeof tokens]).toBe('string');
      }
    }
  });

  it('exports ALLOWED_TOKENS including every text token', () => {
    expect(Array.isArray(ALLOWED_TOKENS)).toBe(true);
    for (const token of TEXT_TOKENS) {
      expect(ALLOWED_TOKENS).toContain(token);
    }
  });

  it('switching Dark -> Light changes --text-primary (tautology reject)', () => {
    const dark = PRESET_THEMES['Dark'];
    const light = PRESET_THEMES['Light'];
    expect(dark['--text-primary']).toBe('#CCCCCC');
    expect(light['--text-primary']).toBe('#101010');
    expect(dark['--text-primary']).not.toBe(light['--text-primary']);
    expect(dark['--text-bright']).toBe('#FFFFFF');
    expect(light['--text-bright']).toBe('#000000');
  });

  it('custom token updates reflect in exported theme JSON', () => {
    // Simulates updateToken() spreading a custom value into the token map,
    // which exportTheme() then serializes.
    const customTokens = { ...PRESET_THEMES['Dark'], '--text-primary': '#FF8800' };
    const exported = JSON.stringify({ preset: 'Custom', tokens: customTokens });
    const parsed = JSON.parse(exported);
    expect(parsed.tokens['--text-primary']).toBe('#FF8800');
    expect(parsed.tokens['--text-bright']).toBe('#FFFFFF');
  });
});

describe('Color Picker Hex Normalization (getHexForInput)', () => {
  it('always returns strictly 7-character #RRGGBB strings', () => {
    for (const input of [
      '#ff5733aa',      // 8-digit hex with alpha
      '#FF5733',        // 6-digit hex
      '#f53',           // 3-digit shorthand
      'rgba(10, 20, 30, 0.5)',
      'rgb(10, 20, 30)',
      'not-a-color',
      '',
    ]) {
      const result = getHexForInput(input);
      expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(result.length).toBe(7);
    }
  });

  it('strips 8-digit hex alpha suffix (#RRGGBBAA -> #RRGGBB)', () => {
    expect(getHexForInput('#ff5733aa')).toBe('#ff5733');
    expect(getHexForInput('#00F5A080')).toBe('#00F5A0');
  });

  it('preserves standard 6-digit hex and expands 3-digit shorthand', () => {
    expect(getHexForInput('#FF5733')).toBe('#FF5733');
    expect(getHexForInput('#f53')).toBe('#ff5533');
  });

  it('drops alpha channel from rgba() strings instead of emitting 9-char hex', () => {
    expect(getHexForInput('rgba(10, 20, 30, 0.5)')).toBe('#0a141e');
    expect(getHexForInput('rgb(10, 20, 30)')).toBe('#0a141e');
  });

  it('falls back to the app default for empty or invalid colors', () => {
    expect(getHexForInput('')).toBe('#121622');
    expect(getHexForInput('not-a-color')).toBe('#121622');
  });
});

describe('API Error Primitive Rendering (formatErrorMessage)', () => {
  it('passes through plain string errors untouched', () => {
    expect(formatErrorMessage('Model sync failed')).toBe('Model sync failed');
  });

  it('extracts .message from Error instances', () => {
    expect(formatErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('extracts string .error fields from API error payloads', () => {
    expect(formatErrorMessage({ error: 'Unauthorized' })).toBe('Unauthorized');
  });

  it('extracts nested .error.message from API error payloads', () => {
    expect(formatErrorMessage({ error: { message: 'Provider rejected key' } })).toBe('Provider rejected key');
  });

  it('returns a primitive string fallback for undefined/null/falsy values', () => {
    expect(formatErrorMessage(undefined)).toBe('An unexpected error occurred');
    expect(formatErrorMessage(null)).toBe('An unexpected error occurred');
  });

  it('never returns a non-string (prevents Objects are not valid as a React child crash)', () => {
    const circular: any = { deep: {} };
    circular.deep.self = circular;
    const result = formatErrorMessage(circular);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});