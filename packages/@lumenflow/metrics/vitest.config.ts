import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/dist/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85, // Defensive branches in graph algorithms are difficult to test
        statements: 90,
      },
    },
  },
});
