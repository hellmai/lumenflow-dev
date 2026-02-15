#!/usr/bin/env node
/**
 * Thin wrapper that delegates to @lumenflow/cli's init command.
 * This package exists so `npx lumenflow init` resolves correctly
 * (npm requires the bare package name to match for npx resolution).
 *
 * WU-1690
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from this file to find @lumenflow/cli in node_modules.
// This avoids Node's exports resolution which blocks subpath access.
const __dirname = dirname(fileURLToPath(import.meta.url));
let dir = __dirname;
let initPath;

while (dir !== dirname(dir)) {
  const candidate = join(dir, 'node_modules', '@lumenflow', 'cli', 'dist', 'init.js');
  if (existsSync(candidate)) {
    initPath = candidate;
    break;
  }
  dir = dirname(dir);
}

if (!initPath) {
  console.error('[lumenflow] Could not find @lumenflow/cli. Run: npm install @lumenflow/cli');
  process.exit(1);
}

try {
  execFileSync(process.execPath, [initPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
