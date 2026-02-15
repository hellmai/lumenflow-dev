import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateCodePathsExistence,
  validateTestPathsExistence,
} from '../wu-preflight-validators.js';

function createTmpRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'wu-preflight-reality-'));
}

function writeRepoFile(root: string, relativePath: string, content = ''): void {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

describe('wu-preflight validators (reality adapters)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('expands glob code_paths and passes when at least one file matches', () => {
    const root = createTmpRepo();
    tempDirs.push(root);

    writeRepoFile(root, 'packages/@lumenflow/core/package.json', '{}');

    const result = validateCodePathsExistence(['packages/@lumenflow/*/package.json'], root);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('fails glob code_paths existence when no files match', () => {
    const root = createTmpRepo();
    tempDirs.push(root);

    const result = validateCodePathsExistence(['packages/@lumenflow/*/package.json'], root);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['packages/@lumenflow/*/package.json']);
  });

  it('ignores prose entries in tests.unit during existence check', () => {
    const root = createTmpRepo();
    tempDirs.push(root);

    const result = validateTestPathsExistence(
      {
        unit: ['N/A - metadata-only changes, no unit tests needed'],
      },
      root,
    );

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('still validates real automated test paths and reports missing files', () => {
    const root = createTmpRepo();
    tempDirs.push(root);

    const missingPath = 'packages/@lumenflow/cli/src/__tests__/wu-rules-engine.test.ts';

    const result = validateTestPathsExistence(
      {
        unit: [missingPath],
      },
      root,
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([missingPath]);
  });
});
