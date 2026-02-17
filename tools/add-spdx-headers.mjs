#!/usr/bin/env node
/**
 * Adds SPDX license headers to TypeScript source files.
 * Run from the repo root.
 *
 * Usage: node tools/add-spdx-headers.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const AGPL_HEADER = `// Copyright (c) 2026 Hellmai Ltd\n// SPDX-License-Identifier: AGPL-3.0-only\n`;
const APACHE_HEADER = `// Copyright (c) 2026 Hellmai Ltd\n// SPDX-License-Identifier: Apache-2.0\n`;

const AGPL_PACKAGES = [
  'packages/@lumenflow/kernel',
  'packages/@lumenflow/runtime',
  'packages/@lumenflow/packs',
  'packages/@lumenflow/surfaces',
];

const APACHE_PACKAGES = ['packages/@lumenflow/control-plane-sdk'];

function findTsFiles(dir) {
  const result = execFileSync('git', ['ls-files', `${dir}/**/*.ts`, `${dir}/*.ts`], {
    encoding: 'utf-8',
  }).trim();
  if (!result) return [];
  return result
    .split('\n')
    .filter(
      (f) =>
        !f.includes('node_modules') &&
        !f.includes('/dist/') &&
        !f.endsWith('.d.ts') &&
        !f.includes('vitest.config'),
    );
}

function addHeader(filePath, header) {
  const content = readFileSync(filePath, 'utf-8');
  if (content.includes('SPDX-License-Identifier')) {
    return false;
  }
  if (content.startsWith('#!')) {
    const newlineIdx = content.indexOf('\n');
    const shebang = content.slice(0, newlineIdx + 1);
    const rest = content.slice(newlineIdx + 1);
    writeFileSync(filePath, shebang + '\n' + header + '\n' + rest);
  } else {
    writeFileSync(filePath, header + '\n' + content);
  }
  return true;
}

let modified = 0;
let skipped = 0;

for (const pkg of AGPL_PACKAGES) {
  const files = findTsFiles(pkg);
  for (const f of files) {
    if (addHeader(f, AGPL_HEADER)) {
      console.log(`  AGPL: ${f}`);
      modified++;
    } else {
      skipped++;
    }
  }
}

for (const pkg of APACHE_PACKAGES) {
  const files = findTsFiles(pkg);
  for (const f of files) {
    if (addHeader(f, APACHE_HEADER)) {
      console.log(`  Apache: ${f}`);
      modified++;
    } else {
      skipped++;
    }
  }
}

console.log(`\nDone: ${modified} files modified, ${skipped} already had headers.`);
