// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { MERGE, PREFLIGHT } from '../wu-done-messages.js';

describe('wu-done message templates (WU-1997)', () => {
  it('uses clean conflict wording in branch drift guidance', () => {
    const message = PREFLIGHT.BRANCH_DRIFT_ERROR(3, 5, 'origin', 'main');

    expect(message).toContain('Resolve conflicts that arise');
    expect(message).not.toContain('UnsafeAny');
  });

  it('uses clean wording for code_paths not modified blocker', () => {
    const message = PREFLIGHT.CODE_PATHS_NOT_MODIFIED(['packages/@lumenflow/core/src/example.ts']);

    expect(message).toContain('code_paths files were NOT modified in committed changes');
    expect(message).not.toContain('UnsafeAny');
  });

  it('uses clean conflict wording in fast-forward retry failure guidance', () => {
    const message = MERGE.FF_MERGE_ERROR(
      'lane/framework-core-validation/wu-1997',
      new Error('merge failed'),
      new Error('pull failed'),
    );

    expect(message).toContain('Resolve conflicts');
    expect(message).not.toContain('UnsafeAny');
  });
});
