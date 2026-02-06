import { describe, expect, it } from 'vitest';

import { buildClaimRepairCommand } from '../wu-claim-repair-guidance.js';

describe('WU-1804 claim-repair guidance', () => {
  it('uses wu:repair --claim command (not deprecated alias)', () => {
    const command = buildClaimRepairCommand('WU-1487');
    expect(command).toBe('pnpm wu:repair --claim --id WU-1487');
    expect(command).not.toContain('wu:repair-claim');
  });
});
