import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['tests/component/**', 'jsdom']],
    setupFiles: ['tests/setup.ts'],
  },
});
