import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['tests/component/**', 'jsdom'],
      ['tests/unit/output/**', 'jsdom'],
    ],
    setupFiles: ['tests/setup.ts'],
  },
});
