/**
 * @file tsup.config.ts
 * WU-1926: Bundle @lumenflow/cli for standalone npm publishing.
 *
 * Bundles all workspace dependencies (@lumenflow/*) inline so the published
 * package works without the monorepo. npm-registry dependencies (chalk,
 * commander, etc.) remain external -- users install them normally.
 *
 * Key decisions:
 * - noExternal: @lumenflow/* packages are bundled (workspace:* won't resolve after publish)
 * - format: ESM only (package.json "type": "module")
 * - splitting: true (shared code between 100+ commands is deduplicated into chunks)
 * - shebang: esbuild preserves source shebangs; no banner needed
 * - target: node22 (matches engines.node >= 22)
 *
 * External dependencies include both CLI's direct deps and transitive deps
 * from workspace packages (e.g., micromatch from @lumenflow/core). These must
 * be listed in the published package.json "dependencies" so npm installs them.
 */

import { defineConfig } from 'tsup';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..');

interface PackageJson {
  bin: Record<string, string>;
  dependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')) as PackageJson;

// Derive entry points from bin entries: ./dist/foo.js -> src/foo.ts
// Plus the library exports (index.ts, cli-entry-point.ts)
const binDistPaths = new Set(Object.values(pkg.bin));
const entryPoints = [
  'src/index.ts',
  'src/cli-entry-point.ts',
  ...Array.from(binDistPaths).map((distPath) =>
    distPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'),
  ),
];

/**
 * Collect all npm-registry dependencies that must stay external.
 *
 * When bundling @lumenflow/* workspace packages, their transitive deps
 * (e.g., micromatch, zod) get pulled in. CJS deps like micromatch break
 * in ESM bundles with "Dynamic require of X is not supported". So we
 * externalize ALL non-@lumenflow deps from all bundled workspace packages.
 */
function collectExternalDeps(): string[] {
  const external = new Set<string>();

  // CLI's own dependencies (non-workspace)
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!dep.startsWith('@lumenflow/')) {
      external.add(dep);
    }
  }

  // Workspace packages that get bundled -- collect their deps too
  const workspacePackages = ['core', 'memory', 'agent', 'initiatives', 'metrics', 'kernel'];
  for (const name of workspacePackages) {
    const pkgPath = join(WORKSPACE_ROOT, 'packages', '@lumenflow', name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const wpkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    for (const dep of Object.keys(wpkg.dependencies ?? {})) {
      if (!dep.startsWith('@lumenflow/')) {
        external.add(dep);
      }
    }
  }

  // Node.js built-in modules must always be external
  external.add('node:fs');
  external.add('node:path');
  external.add('node:url');
  external.add('node:child_process');
  external.add('node:os');
  external.add('node:crypto');
  external.add('node:util');
  external.add('node:stream');
  external.add('node:events');
  external.add('node:buffer');
  external.add('node:assert');
  external.add('node:process');
  external.add('node:readline');
  external.add('node:perf_hooks');
  external.add('node:worker_threads');
  external.add('node:net');
  external.add('node:http');
  external.add('node:https');
  external.add('node:timers');
  external.add('node:tty');

  return Array.from(external);
}

const externalDeps = collectExternalDeps();

export default defineConfig({
  entry: entryPoints,
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: true,
  sourcemap: false,
  clean: true,
  dts: false,
  outDir: 'dist',

  // Bundle @lumenflow/* workspace packages inline
  noExternal: [/^@lumenflow\//],

  // Keep npm-registry deps and Node.js builtins external
  external: externalDeps,

  // Shebangs: esbuild preserves #!/usr/bin/env node from source files
  // in entry point output. No banner needed -- all CLI source files
  // already have shebangs. Adding a banner would create double shebangs
  // since esbuild keeps the original and prepends the banner.

  // Preserve import.meta.main for Node.js 22+ compatibility.
  // esbuild supports import.meta natively in ESM output.
  esbuildOptions(options) {
    // Ensure import.meta is not transformed away
    options.supported = {
      ...options.supported,
      'import-meta': true,
    };
  },
});
