/**
 * @file system-map-validator.test.ts
 * @description Tests for system map validation runner
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runSystemMapValidation } from '../../system-map-validator.js';

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lumenflow-system-map-'));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('runSystemMapValidation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('skips when SYSTEM-MAP.yaml is missing', async () => {
    const result = await runSystemMapValidation({ cwd: tmpDir });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });
});
