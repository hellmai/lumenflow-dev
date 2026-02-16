import { describe, expect, it } from 'vitest';
import {
  ApprovalEventSchema,
  POLICY_TRIGGERS,
  PolicyEngine,
  type PolicyLayer,
} from '../policy/index.js';

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
});
