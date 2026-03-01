// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { GateRegistry } from '../src/gate-registry.js';
import { registerCodeGates } from '../src/gate-defaults.js';
import { GATE_NAMES } from '@lumenflow/core/wu-constants';

describe('co-change gate registration', () => {
  it('registers co-change after lint and before test', () => {
    const registry = new GateRegistry();

    registerCodeGates(registry, {
      isFullLint: false,
      isFullTests: false,
      isFullCoverage: false,
      laneHealthMode: 'warn',
      testsRequired: true,
      shouldRunIntegration: false,
      configuredTestFullCmd: 'pnpm turbo run test',
    });

    const names = registry.getAll().map((gate) => gate.name);
    const lintIndex = names.indexOf(GATE_NAMES.LINT);
    const coChangeIndex = names.indexOf(GATE_NAMES.CO_CHANGE);
    const testIndex = names.indexOf(GATE_NAMES.TEST);

    expect(lintIndex).toBeGreaterThanOrEqual(0);
    expect(coChangeIndex).toBeGreaterThan(lintIndex);
    expect(testIndex).toBeGreaterThan(coChangeIndex);
  });
});
