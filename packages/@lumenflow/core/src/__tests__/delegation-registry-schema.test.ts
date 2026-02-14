import { describe, expect, it } from 'vitest';
import {
  DelegationStatus,
  DelegationIntent,
  DELEGATION_STATUSES,
  DELEGATION_INTENTS,
  generateDelegationId,
  validateDelegationEvent,
} from '../delegation-registry-schema.js';

const VALID_TIMESTAMP = '2026-02-14T00:00:00.000Z';

function buildValidDelegationEvent() {
  return {
    id: 'dlg-a1b2',
    parentWuId: 'WU-1000',
    targetWuId: 'WU-1001',
    lane: 'Framework: Core Lifecycle',
    intent: DelegationIntent.DELEGATION,
    delegatedAt: VALID_TIMESTAMP,
    status: DelegationStatus.PENDING,
    completedAt: null,
  };
}

describe('delegation-registry-schema', () => {
  it('exports delegation status and intent sets', () => {
    expect(DELEGATION_STATUSES).toContain(DelegationStatus.PENDING);
    expect(DELEGATION_STATUSES).toContain(DelegationStatus.COMPLETED);
    expect(DELEGATION_INTENTS).toContain(DelegationIntent.DELEGATION);
  });

  it('generates dlg-prefixed delegation IDs', () => {
    const id = generateDelegationId('WU-1000', 'WU-1001');
    expect(id).toMatch(/^dlg-[0-9a-f]{4}$/);
  });

  it('accepts valid delegation events', () => {
    const validation = validateDelegationEvent(buildValidDelegationEvent());
    expect(validation.success).toBe(true);
  });

  it('rejects legacy spawn-prefixed IDs', () => {
    const validation = validateDelegationEvent({
      ...buildValidDelegationEvent(),
      id: 'spawn-a1b2',
    });
    expect(validation.success).toBe(false);
  });
});
