// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create.test.ts
 * Tests for wu:create helpers and warnings (WU-1429)
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import {
  buildWUContent,
  collectInitiativeWarnings,
  commitCloudCreateArtifacts,
  resolveSizingEstimateFromCreateArgs,
  resolveLaneLifecycleForWuCreate,
  validateCreateSpec,
} from '../wu-create.js';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

const BASE_WU = {
  id: 'WU-1429',
  lane: 'Framework: CLI',
  title: 'Test WU',
  priority: 'P2',
  type: 'feature',
  created: '2026-02-04',
  opts: {
    description:
      'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
    acceptance: ['Acceptance criterion'],
    exposure: 'backend-only',
    codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
    testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
    specRefs: ['lumenflow://plans/WU-1429-plan.md'],
  },
};

describe('wu:create helpers (WU-1429)', () => {
  it('cloud create stages files as an array and pushes target branch', async () => {
    const git = {
      add: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
    };

    await commitCloudCreateArtifacts({
      git,
      wuPath: 'docs/04-operations/tasks/wu/WU-1596.yaml',
      backlogPath: 'docs/04-operations/tasks/backlog.md',
      commitMessage: 'docs: create wu-1596 for cloud fixes',
      targetBranch: 'claude/session-1596',
    });

    expect(git.add).toHaveBeenCalledWith([
      'docs/04-operations/tasks/wu/WU-1596.yaml',
      'docs/04-operations/tasks/backlog.md',
    ]);
    expect(git.commit).toHaveBeenCalledWith('docs: create wu-1596 for cloud fixes');
    expect(git.push).toHaveBeenCalledWith('origin', 'claude/session-1596', { setUpstream: true });
  });

  it('should default notes to non-empty placeholder when not provided', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        // Intentionally omit notes
        notes: undefined,
      },
    });

    expect(typeof wu.notes).toBe('string');
    expect(wu.notes.trim().length).toBeGreaterThan(0);
    expect(wu.notes).toContain('(auto)');
  });

  it('should persist notes when provided', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        notes: 'Implementation notes for test',
      },
    });

    expect(wu.notes).toBe('Implementation notes for test');
  });

  it('auto-injects manual test intent for non-code plan-first scopes', () => {
    const validation = validateCreateSpec({
      id: 'WU-2000',
      lane: 'Framework: CLI',
      title: 'Plan-only spec creation',
      priority: 'P2',
      type: 'feature',
      opts: {
        description:
          'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
        acceptance: ['Acceptance criterion'],
        exposure: 'backend-only',
        // Non-code file path: manual-only tests are acceptable.
        codePaths: ['docs/README.md'],
        // No testPathsManual/unit/e2e provided.
        specRefs: ['lumenflow://plans/WU-2000-plan.md'],
        strict: false,
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('should warn when initiative has phases but no --phase is provided', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        phases: [{ id: 1, title: 'Phase 1' }],
      },
      phase: undefined,
      specRefs: ['lumenflow://plans/WU-1429-plan.md'],
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        'Initiative INIT-TEST has phases defined. Consider adding --phase to link this WU to a phase.',
      ]),
    );
  });

  it('should warn when initiative has related_plan but no spec_refs', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        related_plan: 'lumenflow://plans/INIT-TEST-plan.md',
      },
      phase: '1',
      specRefs: [],
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        'Initiative INIT-TEST has related_plan (lumenflow://plans/INIT-TEST-plan.md). Consider adding --spec-refs to link this WU to the plan.',
      ]),
    );
  });

  it('should not warn when phase and spec_refs are provided', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        phases: [{ id: 1, title: 'Phase 1' }],
        related_plan: 'lumenflow://plans/INIT-TEST-plan.md',
      },
      phase: '1',
      specRefs: ['lumenflow://plans/WU-1429-plan.md'],
    });

    expect(warnings).toEqual([]);
  });
});

describe('WU-1530: single-pass validation', () => {
  it('should report all missing field errors in a single pass', () => {
    const result = validateCreateSpec({
      id: 'WU-9990',
      lane: 'Framework: CLI',
      title: 'Test',
      priority: 'P2',
      type: 'bug',
      opts: {
        // All required fields intentionally omitted
        description: undefined,
        acceptance: [],
        exposure: undefined,
        codePaths: [],
        strict: false,
      },
    });

    expect(result.valid).toBe(false);
    // Must report ALL errors at once, not just the first batch
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    const joined = result.errors.join('\n');
    expect(joined).toContain('--description');
    expect(joined).toContain('--acceptance');
    expect(joined).toContain('--exposure');
    expect(joined).toContain('--code-paths');
  });

  it('should report field errors AND schema errors together when both exist', () => {
    // Missing description (field error) + invalid exposure (schema error)
    // Current code: early return on field errors hides schema errors
    // Fixed code: both should appear in single result
    const result = validateCreateSpec({
      id: 'WU-9991',
      lane: 'Framework: CLI',
      title: 'Test',
      priority: 'P2',
      type: 'bug',
      opts: {
        description: undefined, // field error: missing
        acceptance: ['Criterion 1'],
        exposure: 'invalid-exposure-value', // schema error: invalid enum
        codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
        testPathsManual: ['Manual test step'],
        strict: false,
      },
    });

    expect(result.valid).toBe(false);
    const joined = result.errors.join('\n');
    // Field-level error
    expect(joined).toContain('--description');
    // Schema-level error (from Zod validation of exposure enum)
    expect(joined).toContain('exposure');
  });

  it('should still pass when all fields are valid', () => {
    const result = validateCreateSpec({
      id: 'WU-9992',
      lane: 'Framework: CLI',
      title: 'Test',
      priority: 'P2',
      type: 'bug',
      opts: {
        description:
          'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
        acceptance: ['Criterion 1'],
        exposure: 'backend-only',
        codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
        testPathsManual: ['Manual test step'],
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        strict: false,
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('WU-2155: buildWUContent passes through sizing_estimate', () => {
  it('should include sizing_estimate in output when sizingEstimate is provided', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        sizingEstimate: {
          estimated_files: 30,
          estimated_tool_calls: 80,
          strategy: 'checkpoint-resume',
        },
      },
    });

    expect(wu.sizing_estimate).toBeDefined();
    expect(wu.sizing_estimate).toEqual({
      estimated_files: 30,
      estimated_tool_calls: 80,
      strategy: 'checkpoint-resume',
    });
  });

  it('should not include sizing_estimate when sizingEstimate is absent', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        // No sizingEstimate
      },
    });

    expect(wu.sizing_estimate).toBeUndefined();
  });
});

describe('WU-2155: resolveSizingEstimateFromCreateArgs', () => {
  it('returns undefined when no sizing flags are provided', () => {
    const result = resolveSizingEstimateFromCreateArgs({});
    expect(result.sizingEstimate).toBeUndefined();
    expect(result.errors).toEqual([]);
  });

  it('parses valid sizing flags into sizing_estimate', () => {
    const result = resolveSizingEstimateFromCreateArgs({
      estimatedFiles: '30',
      estimatedToolCalls: '90',
      sizingStrategy: 'checkpoint-resume',
      sizingExceptionType: 'docs-only',
      sizingExceptionReason: 'Large docs-only sweep',
    });

    expect(result.errors).toEqual([]);
    expect(result.sizingEstimate).toEqual({
      estimated_files: 30,
      estimated_tool_calls: 90,
      strategy: 'checkpoint-resume',
      exception_type: 'docs-only',
      exception_reason: 'Large docs-only sweep',
    });
  });

  it('returns validation errors for partial sizing input', () => {
    const result = resolveSizingEstimateFromCreateArgs({
      estimatedFiles: '20',
    });

    expect(result.sizingEstimate).toBeUndefined();
    expect(result.errors.some((error) => error.includes('--estimated-tool-calls'))).toBe(true);
    expect(result.errors.some((error) => error.includes('--sizing-strategy'))).toBe(true);
  });
});

describe('WU-1751: wu:create lane lifecycle reads are non-mutating', () => {
  it('does not rewrite legacy config when lifecycle status is inferred', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-create-lifecycle-readonly-'));
    const configPath = path.join(tempDir, 'workspace.yaml');
    const inferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    try {
      const configWithComments = `${SOFTWARE_DELIVERY_KEY}:
  version: "2.0"
  project: test
  # keep this comment
  lanes:
    definitions:
      - name: "Framework: Core"
        wip_limit: 1
        code_paths:
          - "src/core/**"
`;
      fs.writeFileSync(configPath, configWithComments, 'utf-8');
      fs.writeFileSync(
        inferencePath,
        `Framework:
  Core:
    code_paths:
      - src/core/**
`,
        'utf-8',
      );

      const before = fs.readFileSync(configPath, 'utf-8');
      const classification = resolveLaneLifecycleForWuCreate(tempDir);
      const after = fs.readFileSync(configPath, 'utf-8');

      expect(classification.status).toBe('locked');
      expect(classification.persisted).toBe(false);
      expect(after).toBe(before);
      expect(after).toContain('# keep this comment');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
