/**
 * @file supabase-docs-linter.test.ts
 * @description Tests for supabase docs linter runner
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runSupabaseDocsLinter } from '../../validators/supabase-docs-linter.js';

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lumenflow-supabase-linter-'));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('runSupabaseDocsLinter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('skips when the linter file is missing', async () => {
    const result = await runSupabaseDocsLinter({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('runs a local linter module when present', async () => {
    const lintersDir = path.join(tmpDir, 'packages', 'linters');
    mkdirSync(lintersDir, { recursive: true });

    const linterPath = path.join(lintersDir, 'supabase-docs-linter.js');
    writeFileSync(
      linterPath,
      `export function runSupabaseDocsLinter() {\n  return { ok: true, skipped: false, message: 'ok' };\n}`,
    );

    const result = await runSupabaseDocsLinter({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });
});
