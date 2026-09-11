globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  clear: () => {},
  removeItem: () => {}
};

import { PRESET_THEMES } from '../../src/web/context/ThemeContext.js';

describe('Antigravity Theme Presets Integrity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defines Antigravity Dark with correct hex tokens', () => {
    const dark = PRESET_THEMES['Antigravity Dark'];
    expect(dark['--bg-obsidian']).toBe('#101010');
    expect(dark['--text-primary']).toBe('#CCCCCC');
    expect(dark['--accent-primary']).toBe('#007acc');
  });

  it('defines Antigravity Light with correct hex tokens', () => {
    const light = PRESET_THEMES['Antigravity Light'];
    expect(light['--bg-obsidian']).toBe('#F9F9F9');
    expect(light['--text-primary']).toBe('#101010');
    expect(light['--accent-primary']).toBe('#007acc');
  });

  it('does not contain obsolete presets', () => {
    const presets = Object.keys(PRESET_THEMES);
    expect(presets).toEqual(['Antigravity Dark', 'Antigravity Light']);
    expect(presets).not.toContain('Obsidian Stealth');
    expect(presets).not.toContain('Midnight OLED');
    expect(presets).not.toContain('Cyber Mint');
  });
});
