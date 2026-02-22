// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import {
  deriveInitiativeLifecycleStatus,
  deriveInitiativePhaseStatus,
} from '../initiative-status.js';

describe('deriveInitiativeLifecycleStatus', () => {
  it('downgrades done to in_progress when UnsafeAny phase is incomplete', () => {
    const status = deriveInitiativeLifecycleStatus(WU_STATUS.DONE, [
      { id: 1, status: WU_STATUS.DONE },
      { id: 2, status: WU_STATUS.READY },
    ]);

    expect(status).toBe(WU_STATUS.IN_PROGRESS);
  });

  it('keeps done when all phases are done', () => {
    const status = deriveInitiativeLifecycleStatus(WU_STATUS.DONE, [
      { id: 1, status: WU_STATUS.DONE },
      { id: 2, status: WU_STATUS.DONE },
    ]);

    expect(status).toBe(WU_STATUS.DONE);
  });

  it('normalizes case and falls back to in_progress for empty values', () => {
    expect(deriveInitiativeLifecycleStatus(' DONE ', [])).toBe(WU_STATUS.DONE);
    expect(deriveInitiativeLifecycleStatus(undefined, [])).toBe(WU_STATUS.IN_PROGRESS);
  });

  it('upgrades in_progress to done when all linked WUs are complete', () => {
    const status = deriveInitiativeLifecycleStatus(
      WU_STATUS.IN_PROGRESS,
      [{ id: 1, status: WU_STATUS.DONE }],
      { done: 3, total: 3 },
    );

    expect(status).toBe(WU_STATUS.DONE);
  });
});

describe('deriveInitiativePhaseStatus', () => {
  it('upgrades phase status to done when every phase WU is done', () => {
    const status = deriveInitiativePhaseStatus('pending', [
      { id: 'WU-1', doc: { status: WU_STATUS.DONE } },
      { id: 'WU-2', doc: { status: WU_STATUS.DONE } },
    ]);

    expect(status).toBe(WU_STATUS.DONE);
  });
});
