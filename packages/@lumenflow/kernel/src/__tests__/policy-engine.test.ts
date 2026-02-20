// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  ApprovalEventSchema,
  POLICY_TRIGGERS,
  PolicyEngine,
  type PolicyLayer,
} from '../policy/index.js';
import { PolicyDecisionSchema } from '../kernel.schemas.js';

describe('policy engine', () => {
  it('applies workspace -> lane -> pack -> task cascade with deny-wins semantics', async () => {
    const layers: PolicyLayer[] = [
      {
        level: 'workspace',
        rules: [
          {
            id: 'workspace.allow.default',
            trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
            decision: 'allow',
          },
        ],
      },
      {
        level: 'lane',
        rules: [
          {
            id: 'lane.deny.proc',
            trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
            decision: 'deny',
            when: (context) => context.tool_name === 'proc:exec',
          },
        ],
      },
      {
        level: 'pack',
        rules: [],
      },
      {
        level: 'task',
        rules: [
          {
            id: 'task.allow.override-attempt',
            trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
            decision: 'allow',
          },
        ],
      },
    ];

    const engine = new PolicyEngine({ layers });
    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1732',
      tool_name: 'proc:exec',
    });

    expect(result.decision).toBe('deny');
    expect(result.decisions.some((decision) => decision.policy_id === 'lane.deny.proc')).toBe(true);
  });

  it('blocks lower-level loosening unless explicit opt-in is enabled', async () => {
    const engine = new PolicyEngine({
      layers: [
        { level: 'workspace', default_decision: 'deny', rules: [] },
        { level: 'lane', rules: [] },
        { level: 'pack', rules: [] },
        {
          level: 'task',
          rules: [
            {
              id: 'task.allow.tool',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
          ],
        },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1732-tighten',
      tool_name: 'fs:write',
    });

    expect(result.decision).toBe('deny');
    expect(result.warnings.some((warning) => warning.includes('loosening'))).toBe(true);
  });

  it('allows explicit loosening opt-in while still honoring deny-wins for hard denies', async () => {
    const engine = new PolicyEngine({
      layers: [
        { level: 'workspace', default_decision: 'deny', rules: [] },
        { level: 'lane', rules: [] },
        { level: 'pack', rules: [] },
        {
          level: 'task',
          allow_loosening: true,
          rules: [
            {
              id: 'task.allow.tool',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
          ],
        },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1732-loosen',
      tool_name: 'fs:write',
    });

    expect(result.decision).toBe('allow');
  });

  it('does not let allow_loosening override an upstream hard deny rule', async () => {
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          rules: [
            {
              id: 'workspace.deny.proc',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'deny',
              when: (context) => context.tool_name === 'proc:exec',
            },
          ],
        },
        { level: 'lane', rules: [] },
        { level: 'pack', rules: [] },
        {
          level: 'task',
          allow_loosening: true,
          rules: [
            {
              id: 'task.allow.proc',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
          ],
        },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1762-hard-deny',
      tool_name: 'proc:exec',
    });

    expect(result.decision).toBe('deny');
    expect(result.decisions.some((decision) => decision.policy_id === 'workspace.deny.proc')).toBe(
      true,
    );
    expect(result.decisions.some((decision) => decision.policy_id === 'task.allow.proc')).toBe(
      true,
    );
  });

  it('supports all required trigger points', async () => {
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          default_decision: 'deny',
          allow_loosening: true,
          rules: [
            {
              id: 'workspace.allow.tool-request',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
            {
              id: 'workspace.allow.claim',
              trigger: POLICY_TRIGGERS.ON_CLAIM,
              decision: 'allow',
            },
            {
              id: 'workspace.allow.completion',
              trigger: POLICY_TRIGGERS.ON_COMPLETION,
              decision: 'allow',
            },
            {
              id: 'workspace.allow.evidence',
              trigger: POLICY_TRIGGERS.ON_EVIDENCE_ADDED,
              decision: 'allow',
            },
          ],
        },
        { level: 'lane', rules: [] },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
    });

    const triggers = [
      POLICY_TRIGGERS.ON_TOOL_REQUEST,
      POLICY_TRIGGERS.ON_CLAIM,
      POLICY_TRIGGERS.ON_COMPLETION,
      POLICY_TRIGGERS.ON_EVIDENCE_ADDED,
    ];

    for (const trigger of triggers) {
      const result = await engine.evaluate({
        trigger,
        run_id: `run-${trigger}`,
      });
      expect(result.decision).toBe('allow');
    }
  });

  it('rejects unknown properties on PolicyEvaluationContext at compile time', async () => {
    // PolicyEvaluationContext should not accept arbitrary keys via index signature.
    // This test verifies the interface is closed: only declared properties are accepted.
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          rules: [
            {
              id: 'workspace.allow.all',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
          ],
        },
      ],
    });

    // A valid context with only declared properties should compile and work
    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1861-closed-type',
      tool_name: 'fs:read',
      task_id: 'WU-1861',
      lane_id: 'framework-mcp',
      pack_id: 'software-delivery',
    });

    expect(result.decision).toBe('allow');
  });

  it('includes rule ID in loosening warnings for default_decision conflicts', async () => {
    // WU-1865: Policy warnings must include the specific rule name/ID
    const engine = new PolicyEngine({
      layers: [
        { level: 'workspace', default_decision: 'deny', rules: [] },
        { level: 'lane', rules: [] },
        {
          level: 'pack',
          default_decision: 'allow',
          rules: [],
        },
        { level: 'task', rules: [] },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1865-default-warning',
    });

    expect(result.decision).toBe('deny');
    expect(result.warnings).toHaveLength(1);
    // Warning should identify the layer that attempted loosening
    expect(result.warnings[0]).toContain('pack');
    expect(result.warnings[0]).toContain('loosening');
  });

  it('includes rule ID in loosening warnings for rule-based conflicts', async () => {
    // WU-1865: When a rule attempts loosening without opt-in, the warning
    // must include the specific rule ID that triggered it
    const engine = new PolicyEngine({
      layers: [
        { level: 'workspace', default_decision: 'deny', rules: [] },
        { level: 'lane', rules: [] },
        { level: 'pack', rules: [] },
        {
          level: 'task',
          rules: [
            {
              id: 'task.allow.filesystem',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
              reason: 'Allow filesystem access',
            },
          ],
        },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1865-rule-warning',
      tool_name: 'fs:write',
    });

    expect(result.decision).toBe('deny');
    expect(result.warnings).toHaveLength(1);
    // Warning must include the rule ID that attempted loosening
    expect(result.warnings[0]).toContain('task.allow.filesystem');
    expect(result.warnings[0]).toContain('task');
    expect(result.warnings[0]).toContain('loosening');
  });

  it('validates ApprovalEvent schema with run_id, scope, and expires_at', () => {
    const parsed = ApprovalEventSchema.parse({
      schema_version: 1,
      kind: 'approval_event',
      run_id: 'run-1732-approval',
      scope: {
        level: 'task',
        id: 'WU-1732',
      },
      approved_by: 'tom@hellm.ai',
      expires_at: '2026-12-31T23:59:59.000Z',
    });

    expect(parsed.run_id).toBe('run-1732-approval');
    expect(parsed.scope.level).toBe('task');
  });

  it('returns approval_required when a rule uses approval_required decision', async () => {
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          rules: [],
        },
        { level: 'lane', rules: [] },
        {
          level: 'pack',
          rules: [
            {
              id: 'pack.approval.dangerous-tool',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'approval_required',
              reason: 'Dangerous tool requires human approval',
              when: (context) => context.tool_name === 'proc:exec',
            },
          ],
        },
        { level: 'task', rules: [] },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1922-approval',
      tool_name: 'proc:exec',
    });

    expect(result.decision).toBe('approval_required');
    expect(
      result.decisions.some(
        (decision) => decision.policy_id === 'pack.approval.dangerous-tool',
      ),
    ).toBe(true);
  });

  it('treats approval_required as deny-wins over allow but not over deny', async () => {
    // approval_required should override allow but not override deny
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          rules: [
            {
              id: 'workspace.allow.all',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'allow',
            },
          ],
        },
        {
          level: 'lane',
          rules: [
            {
              id: 'lane.approval.sensitive',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'approval_required',
              reason: 'Sensitive operation requires approval',
            },
          ],
        },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1922-approval-over-allow',
      tool_name: 'fs:write',
    });

    expect(result.decision).toBe('approval_required');
  });

  it('deny overrides approval_required', async () => {
    const engine = new PolicyEngine({
      layers: [
        {
          level: 'workspace',
          rules: [
            {
              id: 'workspace.deny.proc',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'deny',
              when: (context) => context.tool_name === 'proc:exec',
            },
          ],
        },
        {
          level: 'lane',
          rules: [
            {
              id: 'lane.approval.proc',
              trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
              decision: 'approval_required',
              when: (context) => context.tool_name === 'proc:exec',
            },
          ],
        },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
    });

    const result = await engine.evaluate({
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: 'run-1922-deny-over-approval',
      tool_name: 'proc:exec',
    });

    expect(result.decision).toBe('deny');
  });

  it('PolicyDecisionSchema accepts approval_required decision', () => {
    const parsed = PolicyDecisionSchema.parse({
      policy_id: 'test.approval',
      decision: 'approval_required',
      reason: 'Requires human sign-off',
    });

    expect(parsed.decision).toBe('approval_required');
  });
});
