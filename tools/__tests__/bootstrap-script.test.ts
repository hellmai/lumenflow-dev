/**
 * @file bootstrap-script.test.ts
 * Test suite for dependency-closure bootstrap script (WU-1480)
 *
 * WU-1480: dist-backed CLI commands like lane:health fail in fresh worktrees
 *          when only @lumenflow/cli is built. The bootstrap script builds
 *          @lumenflow/cli with its full dependency closure via turbo --filter.
 *
 * Tests:
 * - Root package.json contains a "bootstrap" script
 * - Bootstrap script uses turbo build with --filter=@lumenflow/cli
 * - The filter ensures dependency closure (core, memory, metrics, initiatives, agent)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getRootPackageJson(): Record<string, unknown> {
  const rootDir = resolve(import.meta.dirname, '../..');
  const raw = readFileSync(resolve(rootDir, 'package.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('dependency-closure bootstrap script (WU-1480)', () => {
  it('should define a "bootstrap" script in root package.json', () => {
    const pkg = getRootPackageJson();
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts).toHaveProperty('bootstrap');
  });

  it('should use turbo build with --filter=@lumenflow/cli for dependency closure', () => {
    const pkg = getRootPackageJson();
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts.bootstrap).toContain('turbo');
    expect(scripts.bootstrap).toContain('build');
    expect(scripts.bootstrap).toContain('--filter=@lumenflow/cli');
  });
});
