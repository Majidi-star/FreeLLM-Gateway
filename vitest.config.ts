import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
});