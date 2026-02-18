import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lumenflow/kernel': path.join(REPO_ROOT, 'packages/@lumenflow/kernel/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/__tests__/**/*.test.ts',
      'packages/**/*.spec.ts',
      'apps/**/__tests__/**/*.test.ts',
      'tools/**/__tests__/**/*.test.ts',
      '.husky/hooks/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/__tests__/**', '**/*.config.*'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    passWithNoTests: true,
  },
});
