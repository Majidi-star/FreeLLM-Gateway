import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,html}',
    './PLAN/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#090a0f',
        rail: '#0d1017',
        card: '#121622',
        cardActive: '#161b28',
        accent: '#7c9cff',
        mint: '#00f5a0',
        amber: '#ffb800',
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
