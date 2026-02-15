/**
 * Validates that every bin entry in package.json has a #!/usr/bin/env node
 * shebang in the corresponding source file (WU-1689).
 *
 * This is the automated test counterpart to scripts/check-shebangs.mjs
 * (which runs at build time against dist files). This test validates
 * the source files directly so it catches issues before building.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const srcDir = join(__dirname, '..');

describe('bin entry shebangs', () => {
  const binEntries = Object.entries(pkg.bin as Record<string, string>);
  const seen = new Set<string>();

  for (const [name, relPath] of binEntries) {
    // Convert dist path to src path: ./dist/foo.js -> foo.ts
    const srcFile = relPath.replace('./dist/', '').replace('.js', '.ts');
    if (seen.has(srcFile)) continue;
    seen.add(srcFile);

    it(`${name} (${srcFile}) should have a shebang`, () => {
      const fullPath = join(srcDir, srcFile);
      const content = readFileSync(fullPath, 'utf8');
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
    });
  }
});
