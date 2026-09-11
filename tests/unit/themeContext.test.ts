globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  clear: () => {},
  removeItem: () => {}
};

import { PRESET_THEMES } from '../../src/web/context/ThemeContext.js';

describe('Theme Presets Integrity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defines Dark theme with correct hex tokens', () => {
    const dark = PRESET_THEMES['Dark'];
    expect(dark['--bg-obsidian']).toBe('#101010');
    expect(dark['--text-primary']).toBe('#CCCCCC');
    expect(dark['--accent-primary']).toBe('#007acc');
  });

  it('defines Light theme with correct hex tokens', () => {
    const light = PRESET_THEMES['Light'];
    expect(light['--bg-obsidian']).toBe('#F9F9F9');
    expect(light['--text-primary']).toBe('#101010');
    expect(light['--accent-primary']).toBe('#007acc');
  });

  it('does not contain obsolete presets', () => {
    const presets = Object.keys(PRESET_THEMES);
    expect(presets).toEqual(['Dark', 'Light']);
    expect(presets).not.toContain('Obsidian Stealth');
    expect(presets).not.toContain('Midnight OLED');
    expect(presets).not.toContain('Cyber Mint');
  });
});
