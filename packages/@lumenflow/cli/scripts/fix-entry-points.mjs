/**
 * @file fix-entry-points.mjs
 * WU-1926: Post-build fixup for tsup code-split output.
 *
 * Problem: When tsup/esbuild splits code, the `import.meta.main` guard
 * can end up in a shared chunk instead of the entry point file. Since
 * import.meta.main is only true for the file passed to `node`, the guard
 * in a chunk never fires -- so `main()` is never called.
 *
 * Solution: For each bin entry that lost its import.meta.main guard during
 * code splitting, this script appends the guard to the entry point file.
 * It detects whether `main` and `runCLI` are available and adds:
 *   import { runCLI } from "./chunk-XXX.js";
 *   if (import.meta.main) { void runCLI(main); }
 *
 * This script runs after tsup but before check-shebangs.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const binEntries = Object.entries(pkg.bin);

/**
 * Find the chunk file that exports runCLI.
 * We scan chunk files for the pattern: export { runCLI } or runCLI in export block.
 */
function findRunCLIChunk() {
  const chunkFiles = readdirSync(distDir).filter(
    (f) => f.startsWith('chunk-') && f.endsWith('.js'),
  );
  for (const chunk of chunkFiles) {
    const content = readFileSync(join(distDir, chunk), 'utf8');
    // Look for runCLI being exported from this chunk
    if (/export\s*\{[^}]*\brunCLI\b[^}]*\}/.test(content)) {
      return `./${chunk}`;
    }
    // Also check for inline export: export async function runCLI
    if (/export\s+(async\s+)?function\s+runCLI/.test(content)) {
      return `./${chunk}`;
    }
  }
  return null;
}

const runCLIChunk = findRunCLIChunk();
let fixedCount = 0;

for (const [name, relPath] of binEntries) {
  const distFile = join(__dirname, '..', relPath);
  let content;
  try {
    content = readFileSync(distFile, 'utf8');
  } catch {
    continue; // File not found, skip
  }

  // Skip if already has import.meta.main guard
  if (content.includes('import.meta.main')) {
    continue;
  }

  // Check if this entry re-exports `main` from a chunk
  // Pattern: `main` appears in the export block
  const hasMainExport = /export\s*\{[^}]*\bmain\b[^}]*\}/.test(content);
  if (!hasMainExport) {
    continue;
  }

  // Check if runCLI is already imported in this entry
  const hasRunCLI = content.includes('runCLI');

  let guard;
  if (hasRunCLI) {
    // runCLI is already imported from a chunk
    guard = '\nif (import.meta.main) {\n  void runCLI(main);\n}\n';
  } else if (runCLIChunk) {
    // Import runCLI from its chunk and use it
    guard = `\nimport { runCLI as __runCLI } from "${runCLIChunk}";\nif (import.meta.main) {\n  void __runCLI(main);\n}\n`;
  } else {
    // Fallback: call main() directly (no error wrapper)
    guard = '\nif (import.meta.main) {\n  void main();\n}\n';
  }

  writeFileSync(distFile, content + guard);
  fixedCount++;
}

console.log(`[fix-entry-points] Patched ${fixedCount} entry points with import.meta.main guard.`);
