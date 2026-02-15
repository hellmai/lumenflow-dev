/**
 * @file wu-1683-plan-field.test.ts
 * Test suite for WU-1683: First-class plan field
 *
 * Tests:
 * - Schema accepts optional plan field
 * - applyEdits handles --plan flag (wu:edit)
 * - buildWUContent includes plan field (wu:create)
 * - linkPlanToWU sets wu.plan (not spec_refs)
 * - wu:status formatWuState shows plan
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// Import from dist (built files) — matches existing test convention
import { applyEdits } from '../dist/wu-edit.js';
import { buildWUContent } from '../dist/wu-create.js';
import { linkPlanToWU } from '../dist/plan-link.js';
import { validateReadyWU } from '@lumenflow/core/wu-schema';
import { getPlanProtocolRef } from '@lumenflow/core/lumenflow-home';

// ---------------------------------------------------------------------------
// 1. Schema: plan field accepted
// ---------------------------------------------------------------------------
describe('WU schema plan field (WU-1683)', () => {
  const baseWU = {
    id: 'WU-9999',
    title: 'Test WU',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'ready',
    priority: 'P2',
    created: '2026-02-15',
    code_paths: ['packages/@lumenflow/cli/src/wu-create.ts'],
    tests: { manual: ['Verify plan field'], unit: [], e2e: [] },
    artifacts: ['.lumenflow/stamps/WU-9999.done'],
    dependencies: [],
    risks: [],
    notes: 'Test notes',
    requires_review: false,
    description:
      'Context: Plans need a first-class field. Problem: spec_refs is generic. Solution: Add plan field to WU schema.',
    acceptance: ['Test criterion'],
    assigned_to: 'test@example.com',
    exposure: 'backend-only',
    spec_refs: ['docs/04-operations/plans/WU-9999-plan.md'],
  };

  it('should accept a WU with plan field set', () => {
    const wu = { ...baseWU, plan: 'lumenflow://plans/WU-9999-plan.md' };
    const result = validateReadyWU(wu);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan).toBe('lumenflow://plans/WU-9999-plan.md');
    }
  });

  it('should accept a WU without plan field (optional)', () => {
    const result = validateReadyWU(baseWU);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. wu:edit applyEdits: --plan flag
// ---------------------------------------------------------------------------
describe('wu:edit --plan (WU-1683)', () => {
  it('should set plan field when --plan is provided', () => {
    const wu = { id: 'WU-1683', status: 'ready' };
    const opts = { plan: 'lumenflow://plans/WU-1683-plan.md' };
    const result = applyEdits(wu, opts);

    expect(result.plan).toBe('lumenflow://plans/WU-1683-plan.md');
  });

  it('should replace existing plan field', () => {
    const wu = {
      id: 'WU-1683',
      status: 'ready',
      plan: 'lumenflow://plans/WU-1683-old.md',
    };
    const opts = { plan: 'lumenflow://plans/WU-1683-plan.md' };
    const result = applyEdits(wu, opts);

    expect(result.plan).toBe('lumenflow://plans/WU-1683-plan.md');
  });

  it('should not mutate original WU object', () => {
    const wu = { id: 'WU-1683', status: 'ready' };
    const opts = { plan: 'lumenflow://plans/WU-1683-plan.md' };
    applyEdits(wu, opts);

    expect(wu.plan).toBeUndefined();
  });

  it('should not touch plan when --plan is not provided', () => {
    const wu = {
      id: 'WU-1683',
      status: 'ready',
      plan: 'lumenflow://plans/WU-1683-plan.md',
    };
    const opts = { description: 'updated desc' };
    const result = applyEdits(wu, opts);

    expect(result.plan).toBe('lumenflow://plans/WU-1683-plan.md');
  });
});

// ---------------------------------------------------------------------------
// 3. wu:create buildWUContent: plan field
// ---------------------------------------------------------------------------
describe('wu:create buildWUContent plan field (WU-1683)', () => {
  const baseOpts = {
    codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
    testPathsManual: ['Verify plan'],
    testPathsUnit: [],
    testPathsE2e: [],
    specRefs: ['docs/04-operations/plans/WU-9999-plan.md'],
  };

  it('should include plan field when provided in opts', () => {
    const planUri = getPlanProtocolRef('WU-9999');
    const result = buildWUContent({
      id: 'WU-9999',
      lane: 'Framework: CLI',
      title: 'Test WU',
      priority: 'P2',
      type: 'feature',
      created: '2026-02-15',
      opts: { ...baseOpts, plan: planUri },
    });

    expect(result.plan).toBe(planUri);
  });

  it('should not include plan field when not provided', () => {
    const result = buildWUContent({
      id: 'WU-9999',
      lane: 'Framework: CLI',
      title: 'Test WU',
      priority: 'P2',
      type: 'feature',
      created: '2026-02-15',
      opts: baseOpts,
    });

    expect(result.plan).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. plan:link linkPlanToWU: sets wu.plan (not spec_refs)
// ---------------------------------------------------------------------------
describe('plan:link linkPlanToWU sets wu.plan (WU-1683)', () => {
  // These tests use fs mocks - linkPlanToWU does file I/O.
  // We test the function's YAML mutation behavior via a temp dir.
  // NOTE: These are integration-style tests that need the function to write
  // to a real temp dir. We'll keep them as unit tests of the mutation logic.

  // Since linkPlanToWU does file I/O directly, we test via the exported function
  // with a real temp directory setup.

  function setupTempWU(wuId: string, fields: Record<string, unknown> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wu-1683-test-'));
    const wuDir = join(dir, 'docs', '04-operations', 'tasks', 'wu');
    mkdirSync(wuDir, { recursive: true });
    const wuContent = {
      id: wuId,
      title: 'Test WU',
      lane: 'Framework: CLI',
      status: 'ready',
      ...fields,
    };
    const yamlStr = Object.entries(wuContent)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}`;
        return `${k}: ${typeof v === 'string' ? `'${v}'` : v}`;
      })
      .join('\n');
    writeFileSync(join(wuDir, `${wuId}.yaml`), yamlStr);
    return dir;
  }

  function readWUYaml(dir: string, wuId: string) {
    const content = readFileSync(
      join(dir, 'docs', '04-operations', 'tasks', 'wu', `${wuId}.yaml`),
      'utf-8',
    );
    return parseYaml(content);
  }

  it('should set plan field on the WU YAML', () => {
    const dir = setupTempWU('WU-9999');
    const planUri = 'lumenflow://plans/WU-9999-plan.md';

    const changed = linkPlanToWU(dir, 'WU-9999', planUri);

    expect(changed).toBe(true);
    const yaml = readWUYaml(dir, 'WU-9999');
    expect(yaml.plan).toBe(planUri);
  });

  it('should NOT add plan URI to spec_refs', () => {
    const dir = setupTempWU('WU-9999', { spec_refs: ['existing-ref.md'] });
    const planUri = 'lumenflow://plans/WU-9999-plan.md';

    linkPlanToWU(dir, 'WU-9999', planUri);

    const yaml = readWUYaml(dir, 'WU-9999');
    expect(yaml.spec_refs).toEqual(['existing-ref.md']);
    expect(yaml.plan).toBe(planUri);
  });

  it('should be idempotent when plan is already set to same URI', () => {
    const dir = setupTempWU('WU-9999', { plan: 'lumenflow://plans/WU-9999-plan.md' });
    const planUri = 'lumenflow://plans/WU-9999-plan.md';

    const changed = linkPlanToWU(dir, 'WU-9999', planUri);

    expect(changed).toBe(false);
  });

  it('should replace existing plan when different URI provided', () => {
    const dir = setupTempWU('WU-9999', { plan: 'lumenflow://plans/WU-9999-old.md' });
    const planUri = 'lumenflow://plans/WU-9999-plan.md';

    const changed = linkPlanToWU(dir, 'WU-9999', planUri);

    expect(changed).toBe(true);
    const yaml = readWUYaml(dir, 'WU-9999');
    expect(yaml.plan).toBe(planUri);
  });
});
