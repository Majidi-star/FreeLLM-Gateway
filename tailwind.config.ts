import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,html}',
    './PLAN/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic Token Names
        'bg-obsidian': 'var(--bg-obsidian)',
        'bg-rail': 'var(--bg-rail)',
        'bg-card': 'var(--bg-card)',
        'bg-card-active': 'var(--bg-card-active)',
        'bg-well': 'var(--bg-well)',
        'border-subtle': 'var(--border-subtle)',
        'border-hover': 'var(--border-hover)',
        'accent-primary': 'var(--accent-primary)',
        'accent-primary-hover': 'var(--accent-primary-hover)',
        'signal-mint': 'var(--signal-mint)',
        'signal-amber': 'var(--signal-amber)',
        'signal-coral': 'var(--signal-coral)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',

        // Backwards-Compatible Short Aliases
        obsidian: 'var(--bg-obsidian)',
        rail: 'var(--bg-rail)',
        card: 'var(--bg-card)',
        cardActive: 'var(--bg-card-active)',
        well: 'var(--bg-well)',
        accent: 'var(--accent-primary)',
        mint: 'var(--signal-mint)',
        amber: 'var(--signal-amber)',
        coral: 'var(--signal-coral)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'squircle-card': '24px',
        'squircle-capsule': '16px',
      },
    },
  },
  plugins: [],
};

export default config;
