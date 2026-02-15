import { describe, expect, it } from 'vitest';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import { deriveInitiativeLifecycleStatus } from '../initiative-status.js';

describe('deriveInitiativeLifecycleStatus', () => {
  it('downgrades done to in_progress when any phase is incomplete', () => {
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
});
