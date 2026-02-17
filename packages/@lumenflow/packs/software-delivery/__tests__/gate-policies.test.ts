// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  SOFTWARE_DELIVERY_GATE_POLICIES,
  resolveSoftwareDeliveryStateAlias,
  runCompletionGatePolicies,
} from '../gate-policies.js';
import { registerSoftwareDeliveryPack } from '../pack-registration.js';

describe('software delivery gate policies', () => {
  it('defines format/lint/typecheck/test/coverage policy providers', () => {
    expect(SOFTWARE_DELIVERY_GATE_POLICIES.map((provider) => provider.gate)).toEqual([
      'format',
      'lint',
      'typecheck',
      'test',
      'coverage',
    ]);
    expect(
      SOFTWARE_DELIVERY_GATE_POLICIES.every((provider) => provider.trigger === 'on_completion'),
    ).toBe(true);
  });

  it('runs gate policies through policy engine on on_completion trigger', async () => {
    const evaluate = vi.fn(async () => ({
      decision: 'allow' as const,
      decisions: [],
      warnings: [],
    }));
    const executedGates: string[] = [];

    const results = await runCompletionGatePolicies({
      engine: { evaluate },
      runId: 'run-1733',
      taskId: 'WU-1733',
      executePolicy: async (provider) => {
        executedGates.push(provider.gate);
        return { ok: true };
      },
    });

    expect(evaluate).toHaveBeenCalledTimes(SOFTWARE_DELIVERY_GATE_POLICIES.length);
    const triggers = evaluate.mock.calls.map(
      (call) => (call[0] as { trigger?: string } | undefined)?.trigger,
    );
    expect(triggers.every((trigger) => trigger === 'on_completion')).toBe(true);
    expect(executedGates).toEqual(['format', 'lint', 'typecheck', 'test', 'coverage']);
    expect(results.every((result) => result.decision === 'allow')).toBe(true);
  });

  it('honors deny decisions from policy engine', async () => {
    const evaluate = vi.fn(async (context: { gate: string }) => ({
      decision: context.gate === 'coverage' ? ('deny' as const) : ('allow' as const),
      decisions: [],
      warnings: [],
    }));
    const executedGates: string[] = [];

    const results = await runCompletionGatePolicies({
      engine: { evaluate },
      runId: 'run-1733',
      taskId: 'WU-1733',
      executePolicy: async (provider) => {
        executedGates.push(provider.gate);
        return { ok: true };
      },
    });

    expect(executedGates).not.toContain('coverage');
    expect(results.find((result) => result.gate === 'coverage')?.decision).toBe('deny');
  });

  it('resolves state alias and registers pack with integrity hash', async () => {
    expect(resolveSoftwareDeliveryStateAlias('active')).toBe('in_progress');
    expect(resolveSoftwareDeliveryStateAlias('done')).toBe('done');

    const registration = await registerSoftwareDeliveryPack();
    expect(registration.manifest.state_aliases.active).toBe('in_progress');
    expect(registration.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
