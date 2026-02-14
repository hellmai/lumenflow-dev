import { describe, expect, it } from 'vitest';
import { DelegationStatus } from '../delegation-registry-schema.js';
import { buildDelegationTree, treeToJSON } from '../delegation-tree.js';

const VALID_TIMESTAMP = '2026-02-14T00:00:00.000Z';

describe('delegation-tree', () => {
  it('builds a tree with delegation field names (not spawn aliases)', () => {
    const delegations = [
      {
        id: 'dlg-a1b2',
        parentWuId: 'WU-1000',
        targetWuId: 'WU-1001',
        lane: 'Framework: Core Lifecycle',
        status: DelegationStatus.PENDING,
        delegatedAt: VALID_TIMESTAMP,
        completedAt: null,
      },
    ];

    const tree = buildDelegationTree(delegations, 'WU-1000');
    const json = treeToJSON(tree) as {
      delegationId: string | null;
      children: Array<{
        delegationId: string;
        delegatedAt: string;
      }>;
      spawnId?: unknown;
    };

    expect(json.delegationId).toBeNull();
    expect(json).not.toHaveProperty('spawnId');
    expect(json.children[0]?.delegationId).toBe('dlg-a1b2');
    expect(json.children[0]?.delegatedAt).toBe(VALID_TIMESTAMP);
  });
});
