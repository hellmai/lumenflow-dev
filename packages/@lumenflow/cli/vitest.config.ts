import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true, // CLI tests are integration tests, not unit tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/dist/**'],
    },
  },
});
