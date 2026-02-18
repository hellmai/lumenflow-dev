import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/': path.join(import.meta.dirname, 'src/'),
      '@lumenflow/kernel': path.join(REPO_ROOT, 'packages/@lumenflow/kernel/src/index.ts'),
      '@lumenflow/surfaces': path.join(REPO_ROOT, 'packages/@lumenflow/surfaces'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
  },
});
