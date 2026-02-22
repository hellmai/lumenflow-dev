// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFormatCheckPlan } from '../gates-plan-resolvers.js';

describe('resolveFormatCheckPlan (WU-1999)', () => {
  it('skips incremental format check when only dist artifact roots changed', () => {
    const plan = resolveFormatCheckPlan({
      changedFiles: [
        'packages/@lumenflow/cli/dist',
        'packages/@lumenflow/core/dist',
        'packages/@lumenflow/mcp/dist',
      ],
    });

    expect(plan.mode).toBe('skip');
    expect(plan.files).toEqual([]);
  });

  it('excludes dist artifact roots but keeps real source files', () => {
    const plan = resolveFormatCheckPlan({
      changedFiles: [
        'packages/@lumenflow/cli/dist',
        'packages/@lumenflow/cli/src/gates-runners.ts',
      ],
    });

    expect(plan.mode).toBe('incremental');
    expect(plan.files).toEqual(['packages/@lumenflow/cli/src/gates-runners.ts']);
  });

  it('still forces full format check when prettier config changes', () => {
    const plan = resolveFormatCheckPlan({
      changedFiles: ['packages/@lumenflow/cli/dist', '.prettierrc'],
    });

    expect(plan.mode).toBe('full');
    expect(plan.reason).toBe('prettier-config');
  });

  it('excludes nested files inside workspace dist artifacts', () => {
    const plan = resolveFormatCheckPlan({
      changedFiles: [
        'packages/@lumenflow/cli/dist/gates.js',
        'packages/@lumenflow/cli/src/gates-plan-resolvers.ts',
      ],
    });

    expect(plan.mode).toBe('incremental');
    expect(plan.files).toEqual(['packages/@lumenflow/cli/src/gates-plan-resolvers.ts']);
  });

  it('filters deleted files from incremental plan when cwd is provided', () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'gates-plan-wu-2021-'));
    const existingFile = 'packages/@lumenflow/cli/src/gates.ts';
    const deletedFile = '.lumenflow.config.yaml';
    const existingFilePath = path.join(sandboxRoot, existingFile);

    mkdirSync(path.dirname(existingFilePath), { recursive: true });
    writeFileSync(existingFilePath, 'fixture');

    try {
      const plan = resolveFormatCheckPlan({
        changedFiles: [existingFile, deletedFile],
        cwd: sandboxRoot,
      });

      expect(plan.mode).toBe('incremental');
      expect(plan.files).toEqual([existingFile]);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});
