import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(APP_ROOT, '../..');

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  outputFileTracingRoot: REPO_ROOT,
  // Turbopack doesn't support extensionAlias yet (vercel/next.js#82945).
  // Until it does, use --webpack for build/typecheck. The webpack callback
  // lets TypeScript .js-extension imports (Node ESM convention) resolve to .ts.
  webpack(config) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.ts': ['.ts', '.js'],
    };
    return config;
  },
};

export default nextConfig;
