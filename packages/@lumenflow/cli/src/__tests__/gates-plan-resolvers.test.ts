// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
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
});
