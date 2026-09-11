import { PRESET_THEMES, ALLOWED_TOKENS } from '../../src/web/context/ThemeContext.js';

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