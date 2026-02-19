import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_DELIVERY_MANIFEST,
  getSoftwareDeliveryMigrationScorecard,
  renderSoftwareDeliveryMigrationScorecard,
} from '../manifest.js';

const PENDING_RUNTIME_TOOL_ENTRY = 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool';
const PENDING_RUNTIME_BASELINE = 89;

describe('software-delivery migration scorecard (WU-1885)', () => {
  it('reports declared, pending-runtime, and real-handler totals', () => {
    const pendingRuntimeEntries = SOFTWARE_DELIVERY_MANIFEST.tools.filter(
      (tool) => tool.entry === PENDING_RUNTIME_TOOL_ENTRY,
    ).length;
    const declaredTools = SOFTWARE_DELIVERY_MANIFEST.tools.length;

    expect(getSoftwareDeliveryMigrationScorecard()).toEqual({
      declaredTools,
      pendingRuntimeEntries,
      realHandlerEntries: declaredTools - pendingRuntimeEntries,
    });
  });

  it('renders machine-readable scorecard output', () => {
    const output = renderSoftwareDeliveryMigrationScorecard();
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      declaredTools: expect.any(Number),
      pendingRuntimeEntries: expect.any(Number),
      realHandlerEntries: expect.any(Number),
    });
  });

  it('enforces non-increasing pending runtime migration baseline', () => {
    const { pendingRuntimeEntries } = getSoftwareDeliveryMigrationScorecard();

    expect(
      pendingRuntimeEntries,
      [
        `software-delivery pending runtime regression: ${pendingRuntimeEntries} > baseline ${PENDING_RUNTIME_BASELINE}.`,
        'If this increase is intentional and approved, update PENDING_RUNTIME_BASELINE in manifest.test.ts',
        'and document the approval in the WU notes.',
      ].join(' '),
    ).toBeLessThanOrEqual(PENDING_RUNTIME_BASELINE);
  });
});
