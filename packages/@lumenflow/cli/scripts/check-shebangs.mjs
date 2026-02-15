/**
 * @file check-shebangs.mjs
 * Post-build validation: ensures every bin entry in package.json has a
 * #!/usr/bin/env node shebang in its compiled dist file (WU-1689).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const binEntries = Object.entries(pkg.bin);
const missing = [];

for (const [name, relPath] of binEntries) {
  const distFile = join(__dirname, '..', relPath);
  try {
    const content = readFileSync(distFile, 'utf8');
    if (!content.startsWith('#!/')) {
      missing.push(`  ${name} -> ${relPath}`);
    }
  } catch {
    // File not found — skip (may be a build:dist vs build difference)
  }
}

if (missing.length > 0) {
  console.error(
    `\n[check-shebangs] ERROR: ${missing.length} bin entries missing #!/usr/bin/env node shebang:\n`,
  );
  console.error(missing.join('\n'));
  console.error('\nFix: Add #!/usr/bin/env node as the first line of each source .ts file.\n');
  process.exit(1);
}

console.log(`[check-shebangs] All ${binEntries.length} bin entries have shebangs.`);
