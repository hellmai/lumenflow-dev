// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for scope-advisory.ts -- initiative scope shape analysis (WU-2142).
 *
 * Covers:
 * - Clean initiative (no advisories)
 * - Over-granular WU-to-file ratio
 * - Overlap concentration (many WUs share same code_paths)
 * - Lane concentration (most WUs in a single lane)
 * - Multiple advisories can fire simultaneously
 * - Edge cases (empty initiatives, missing code_paths)
 */
import { describe, it, expect } from 'vitest';
import type { WUEntry } from '../src/initiative-yaml.js';
import {
  analyseScopeShape,
  formatScopeAdvisory,
  SCOPE_ADVISORY_THRESHOLDS,
  type ScopeAdvisory,
  type ScopeAdvisoryResult,
} from '../src/orchestrator/scope-advisory.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWU(
  id: string,
  overrides: { lane?: string; code_paths?: string[]; status?: string } = {},
): WUEntry {
  return {
    id,
    doc: {
      title: `${id} title`,
      status: overrides.status ?? 'ready',
      lane: overrides.lane ?? 'Framework: Core',
      code_paths: overrides.code_paths ?? [`packages/core/src/${id.toLowerCase()}.ts`],
    },
    path: `docs/04-operations/tasks/wu/${id}.yaml`,
  };
}

// ── Clean initiative (no advisories) ─────────────────────────────────────

describe('analyseScopeShape -- clean initiative (WU-2142)', () => {
  it('returns empty advisories for a well-balanced initiative', () => {
    const wus: WUEntry[] = [
      makeWU('WU-001', { lane: 'Framework: Core', code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-002', { lane: 'Framework: CLI', code_paths: ['packages/cli/src/b.ts'] }),
      makeWU('WU-003', { lane: 'Content: Docs', code_paths: ['docs/guide.md'] }),
    ];

    const result = analyseScopeShape(wus);

    expect(result.advisories).toHaveLength(0);
    expect(result.clean).toBe(true);
  });

  it('returns empty advisories for an empty WU list', () => {
    const result = analyseScopeShape([]);

    expect(result.advisories).toHaveLength(0);
    expect(result.clean).toBe(true);
  });

  it('returns empty advisories for a single WU', () => {
    const wus: WUEntry[] = [makeWU('WU-001')];

    const result = analyseScopeShape(wus);

    expect(result.advisories).toHaveLength(0);
    expect(result.clean).toBe(true);
  });
});

// ── Over-granular (high WU-to-unique-file ratio) ─────────────────────────

describe('analyseScopeShape -- over-granular detection (WU-2142)', () => {
  it('flags when WU count greatly exceeds unique file count', () => {
    // 6 WUs for only 2 unique files = ratio 3.0 (exceeds threshold 2.0)
    const wus: WUEntry[] = [
      makeWU('WU-001', { code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-002', { code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-003', { code_paths: ['packages/core/src/b.ts'] }),
      makeWU('WU-004', { code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-005', { code_paths: ['packages/core/src/b.ts'] }),
      makeWU('WU-006', { code_paths: ['packages/core/src/a.ts'] }),
    ];

    const result = analyseScopeShape(wus);

    expect(result.clean).toBe(false);
    const advisory = result.advisories.find((a) => a.type === 'over-granular');
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe('warning');
    expect(advisory!.detail).toContain('6');
    expect(advisory!.detail).toContain('2');
  });

  it('does not flag when ratio is below threshold', () => {
    // 3 WUs for 3 unique files = ratio 1.0
    const wus: WUEntry[] = [
      makeWU('WU-001', { code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-002', { code_paths: ['packages/core/src/b.ts'] }),
      makeWU('WU-003', { code_paths: ['packages/core/src/c.ts'] }),
    ];

    const result = analyseScopeShape(wus);

    const advisory = result.advisories.find((a) => a.type === 'over-granular');
    expect(advisory).toBeUndefined();
  });

  it('handles WUs with no code_paths gracefully', () => {
    const wus: WUEntry[] = [
      makeWU('WU-001', { code_paths: undefined }),
      makeWU('WU-002', { code_paths: [] }),
      makeWU('WU-003', { code_paths: ['packages/core/src/a.ts'] }),
    ];

    // Should not throw, and should not flag over-granular
    const result = analyseScopeShape(wus);
    expect(result).toBeDefined();
  });
});

// ── Overlap concentration ────────────────────────────────────────────────

describe('analyseScopeShape -- overlap concentration (WU-2142)', () => {
  it('flags when many WUs touch the same file path', () => {
    // 4 out of 5 WUs touch the same file = 80% overlap
    const sharedPath = 'packages/core/src/shared.ts';
    const wus: WUEntry[] = [
      makeWU('WU-001', { code_paths: [sharedPath, 'packages/core/src/a.ts'] }),
      makeWU('WU-002', { code_paths: [sharedPath, 'packages/core/src/b.ts'] }),
      makeWU('WU-003', { code_paths: [sharedPath] }),
      makeWU('WU-004', { code_paths: [sharedPath, 'packages/core/src/c.ts'] }),
      makeWU('WU-005', { code_paths: ['packages/core/src/d.ts'] }),
    ];

    const result = analyseScopeShape(wus);

    expect(result.clean).toBe(false);
    const advisory = result.advisories.find((a) => a.type === 'overlap-heavy');
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe('warning');
    expect(advisory!.detail).toContain(sharedPath);
  });

  it('does not flag when overlap is within acceptable bounds', () => {
    // 2 out of 5 WUs touch the same file = 40% overlap (below 50% threshold)
    const wus: WUEntry[] = [
      makeWU('WU-001', { code_paths: ['packages/core/src/a.ts'] }),
      makeWU('WU-002', { code_paths: ['packages/core/src/a.ts', 'packages/core/src/b.ts'] }),
      makeWU('WU-003', { code_paths: ['packages/core/src/c.ts'] }),
      makeWU('WU-004', { code_paths: ['packages/core/src/d.ts'] }),
      makeWU('WU-005', { code_paths: ['packages/core/src/e.ts'] }),
    ];

    const result = analyseScopeShape(wus);

    const advisory = result.advisories.find((a) => a.type === 'overlap-heavy');
    expect(advisory).toBeUndefined();
  });
});

// ── Lane concentration ───────────────────────────────────────────────────

describe('analyseScopeShape -- lane concentration (WU-2142)', () => {
  it('flags when most WUs are concentrated in a single lane', () => {
    // 5 out of 6 WUs in same lane = 83% concentration
    const wus: WUEntry[] = [
      makeWU('WU-001', { lane: 'Framework: Core' }),
      makeWU('WU-002', { lane: 'Framework: Core' }),
      makeWU('WU-003', { lane: 'Framework: Core' }),
      makeWU('WU-004', { lane: 'Framework: Core' }),
      makeWU('WU-005', { lane: 'Framework: Core' }),
      makeWU('WU-006', { lane: 'Framework: CLI' }),
    ];

    const result = analyseScopeShape(wus);

    expect(result.clean).toBe(false);
    const advisory = result.advisories.find((a) => a.type === 'lane-heavy');
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe('warning');
    expect(advisory!.detail).toContain('Framework: Core');
    expect(advisory!.detail).toContain('5');
  });

  it('does not flag when WUs are distributed across lanes', () => {
    // 2 out of 4 WUs in same lane = 50% (at threshold but not exceeding)
    const wus: WUEntry[] = [
      makeWU('WU-001', { lane: 'Framework: Core' }),
      makeWU('WU-002', { lane: 'Framework: Core' }),
      makeWU('WU-003', { lane: 'Framework: CLI' }),
      makeWU('WU-004', { lane: 'Content: Docs' }),
    ];

    const result = analyseScopeShape(wus);

    const advisory = result.advisories.find((a) => a.type === 'lane-heavy');
    expect(advisory).toBeUndefined();
  });

  it('does not flag lane concentration when total WUs < minimum threshold', () => {
    // 2 out of 2 WUs in same lane = 100%, but only 2 WUs total
    const wus: WUEntry[] = [
      makeWU('WU-001', { lane: 'Framework: Core' }),
      makeWU('WU-002', { lane: 'Framework: Core' }),
    ];

    const result = analyseScopeShape(wus);

    const advisory = result.advisories.find((a) => a.type === 'lane-heavy');
    expect(advisory).toBeUndefined();
  });
});

// ── Multiple advisories simultaneously ───────────────────────────────────

describe('analyseScopeShape -- combined advisories (WU-2142)', () => {
  it('can fire multiple advisory types at once', () => {
    // Over-granular (6 WUs, 2 unique files = ratio 3.0)
    // Overlap-heavy (5 of 6 WUs share a file)
    // Lane-heavy (5 of 6 WUs in same lane)
    const sharedPath = 'packages/core/src/shared.ts';
    const wus: WUEntry[] = [
      makeWU('WU-001', { lane: 'Framework: Core', code_paths: [sharedPath] }),
      makeWU('WU-002', { lane: 'Framework: Core', code_paths: [sharedPath] }),
      makeWU('WU-003', { lane: 'Framework: Core', code_paths: [sharedPath] }),
      makeWU('WU-004', { lane: 'Framework: Core', code_paths: [sharedPath] }),
      makeWU('WU-005', {
        lane: 'Framework: Core',
        code_paths: [sharedPath, 'packages/core/src/other.ts'],
      }),
      makeWU('WU-006', { lane: 'Framework: CLI', code_paths: [sharedPath] }),
    ];

    const result = analyseScopeShape(wus);

    expect(result.clean).toBe(false);
    const types = result.advisories.map((a) => a.type);
    expect(types).toContain('over-granular');
    expect(types).toContain('overlap-heavy');
    expect(types).toContain('lane-heavy');
  });
});

// ── Threshold exports ────────────────────────────────────────────────────

describe('SCOPE_ADVISORY_THRESHOLDS (WU-2142)', () => {
  it('exports configurable thresholds', () => {
    expect(SCOPE_ADVISORY_THRESHOLDS).toBeDefined();
    expect(typeof SCOPE_ADVISORY_THRESHOLDS.OVER_GRANULAR_RATIO).toBe('number');
    expect(typeof SCOPE_ADVISORY_THRESHOLDS.OVERLAP_PERCENTAGE).toBe('number');
    expect(typeof SCOPE_ADVISORY_THRESHOLDS.LANE_CONCENTRATION_PERCENTAGE).toBe('number');
    expect(typeof SCOPE_ADVISORY_THRESHOLDS.MIN_WUS_FOR_LANE_CHECK).toBe('number');
  });
});

// ── formatScopeAdvisory ──────────────────────────────────────────────────

describe('formatScopeAdvisory (WU-2142)', () => {
  it('returns empty string for clean result', () => {
    const result: ScopeAdvisoryResult = { advisories: [], clean: true };
    const output = formatScopeAdvisory(result);
    expect(output).toBe('');
  });

  it('formats a single advisory', () => {
    const result: ScopeAdvisoryResult = {
      advisories: [
        {
          type: 'over-granular',
          severity: 'warning',
          detail: '6 WUs touch only 2 unique files (ratio: 3.0)',
          suggestion: 'Consider merging related WUs to reduce context-switching overhead.',
        },
      ],
      clean: false,
    };

    const output = formatScopeAdvisory(result);
    expect(output).toContain('Scope Advisory');
    expect(output).toContain('over-granular');
    expect(output).toContain('6 WUs');
    expect(output).toContain('Consider merging');
  });

  it('formats multiple advisories', () => {
    const result: ScopeAdvisoryResult = {
      advisories: [
        {
          type: 'over-granular',
          severity: 'warning',
          detail: 'detail 1',
          suggestion: 'suggestion 1',
        },
        {
          type: 'lane-heavy',
          severity: 'warning',
          detail: 'detail 2',
          suggestion: 'suggestion 2',
        },
      ],
      clean: false,
    };

    const output = formatScopeAdvisory(result);
    expect(output).toContain('over-granular');
    expect(output).toContain('lane-heavy');
  });
});
