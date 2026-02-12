import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkWUConsistency: vi.fn(),
  checkAllWUConsistency: vi.fn(),
  repairWUInconsistency: vi.fn(),
}));

vi.mock('../wu-consistency-checker.js', () => ({
  checkWUConsistency: mocks.checkWUConsistency,
  checkAllWUConsistency: mocks.checkAllWUConsistency,
  repairWUInconsistency: mocks.repairWUInconsistency,
}));

describe('wu-repair-core check mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats --all --check as read-only and does not perform repairs', async () => {
    mocks.checkAllWUConsistency.mockResolvedValue({
      valid: false,
      checked: 2,
      errors: [
        {
          type: 'YAML_DONE_STATUS_IN_PROGRESS',
          wuId: 'WU-1001',
          description: 'WU WU-1001 appears in status.md In Progress section',
          canAutoRepair: true,
        },
      ],
    });
    mocks.repairWUInconsistency.mockResolvedValue({ repaired: 1, failed: 0, skipped: 0 });

    const { runConsistencyRepairMode } = await import('../wu-repair-core.js');
    const result = await runConsistencyRepairMode({ all: true, check: true });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(mocks.repairWUInconsistency).not.toHaveBeenCalled();
  });

  it('selects branch-pr admin repair path from claimed_mode', async () => {
    const { shouldUseBranchPrAdminRepairPath } = await import('../wu-repair-core.js');

    expect(shouldUseBranchPrAdminRepairPath({ claimed_mode: 'branch-pr' })).toBe(true);
    expect(shouldUseBranchPrAdminRepairPath({ claimed_mode: 'worktree' })).toBe(false);
  });
});
