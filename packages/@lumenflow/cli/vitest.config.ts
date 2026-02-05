import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      '__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.ts',
      'e2e/**/*.test.ts',
      'e2e/**/*.spec.ts',
      '**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false, // Fail fast if include globs don't match any tests.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/dist/**'],
    },
  },
});
