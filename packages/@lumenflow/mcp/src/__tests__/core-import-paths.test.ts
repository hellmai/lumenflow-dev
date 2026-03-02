// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TS_FILE_SUFFIX = '.ts';
const TEST_FILE_SUFFIX = '.test.ts';
const CORE_ROOT_IMPORT = "from '@lumenflow/core'";
const MCP_SRC_ROOT = path.resolve(import.meta.dirname, '..');

function collectSourceFiles(dirPath: string, filePaths: string[] = []): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }
      collectSourceFiles(absolutePath, filePaths);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(TS_FILE_SUFFIX) || entry.name.endsWith(TEST_FILE_SUFFIX)) {
      continue;
    }

    filePaths.push(absolutePath);
  }

  return filePaths;
}

describe('MCP core imports', () => {
  it('uses scoped @lumenflow/core entrypoints (not root barrel) in runtime code', () => {
    const sourceFiles = collectSourceFiles(MCP_SRC_ROOT);
    const violations: string[] = [];

    for (const sourceFile of sourceFiles) {
      const fileContent = readFileSync(sourceFile, 'utf8');
      if (fileContent.includes(CORE_ROOT_IMPORT)) {
        violations.push(path.relative(MCP_SRC_ROOT, sourceFile));
      }
    }

    expect(violations).toEqual([]);
  });
});
