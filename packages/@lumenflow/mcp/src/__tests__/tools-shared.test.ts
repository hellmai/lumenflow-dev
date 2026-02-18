/**
 * @file tools-shared.test.ts
 * @description Tests for executeViaPack fallback policy and maintenance scope.
 *
 * WU-1859: Verifies that policy/scope denials and SPEC_TAMPERED errors are
 * returned directly (never retried via CLI), while TOOL_NOT_FOUND and runtime
 * init failures still trigger CLI fallback for backward/migration compat.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOL_ERROR_CODES, type ToolOutput } from '@lumenflow/kernel';
import {
  executeViaPack,
  buildExecutionContext,
  resetExecuteViaPackRuntimeCache,
  type ExecuteViaPackOptions,
  NON_FALLBACK_ERROR_CODES,
  DEFAULT_MAINTENANCE_SCOPE,
} from '../tools-shared.js';
import type { RuntimeInstance } from '../runtime-cache.js';

/** Helper: create a mock RuntimeInstance with a controllable executeTool */
function mockRuntime(executeToolFn: RuntimeInstance['executeTool']): RuntimeInstance {
  return { executeTool: executeToolFn } as unknown as RuntimeInstance;
}

/** Helper: create a mock CliRunnerResult */
function cliSuccess(stdout = 'ok') {
  return { success: true as const, stdout, stderr: '', exitCode: 0, error: undefined };
}
function cliFailure(stderr = 'cli failed') {
  return { success: false as const, stdout: '', stderr, exitCode: 1, error: undefined };
}

describe('executeViaPack fallback policy (WU-1859)', () => {
  const toolName = 'test:tool';
  const toolInput = { id: 'WU-1' };
  const projectRoot = '/tmp/test-project';

  let mockCliRunner: ReturnType<typeof vi.fn>;
  let baseOptions: Omit<ExecuteViaPackOptions, 'runtimeFactory'>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetExecuteViaPackRuntimeCache();
    mockCliRunner = vi.fn();
    baseOptions = {
      projectRoot,
      fallback: { command: 'test:cmd', args: ['--id', 'WU-1'], errorCode: 'TEST_ERROR' },
      cliRunner: mockCliRunner,
    };
  });

  // ───────────────────────────────────────────────
  // AC-1: Policy/scope denials returned directly, never retried via CLI
  // ───────────────────────────────────────────────

  it('returns POLICY_DENIED directly without CLI fallback', async () => {
    const policyDenied: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.POLICY_DENIED, message: 'Policy denies this action' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(policyDenied)),
    );

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(TOOL_ERROR_CODES.POLICY_DENIED);
    expect(result.error?.message).toBe('Policy denies this action');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  it('returns SCOPE_DENIED directly without CLI fallback', async () => {
    const scopeDenied: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.SCOPE_DENIED, message: 'Scope check failed' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(scopeDenied)),
    );

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(TOOL_ERROR_CODES.SCOPE_DENIED);
    expect(result.error?.message).toBe('Scope check failed');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // AC-2: SPEC_TAMPERED returned directly, never retried via CLI
  // ───────────────────────────────────────────────

  it('returns SPEC_TAMPERED directly without CLI fallback', async () => {
    const specTampered: ToolOutput = {
      success: false,
      error: { code: 'SPEC_TAMPERED', message: 'Workspace spec has been tampered with' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(specTampered)),
    );

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SPEC_TAMPERED');
    expect(result.error?.message).toBe('Workspace spec has been tampered with');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // AC-3: Runtime init failures still trigger CLI fallback (backward compat)
  // ───────────────────────────────────────────────

  it('falls back to CLI when runtime factory throws (init failure)', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('Failed to initialize runtime'));
    mockCliRunner.mockResolvedValue(cliSuccess('fallback succeeded'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(true);
    expect(mockCliRunner).toHaveBeenCalledOnce();
  });

  it('falls back to CLI when runtime init fails and reports CLI error on CLI failure', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('Init crash'));
    mockCliRunner.mockResolvedValue(cliFailure('cli also failed'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(mockCliRunner).toHaveBeenCalledOnce();
    expect(result.error?.message).toContain('cli also failed');
  });

  // ───────────────────────────────────────────────
  // AC-4: TOOL_NOT_FOUND still triggers CLI fallback (migration compat)
  // ───────────────────────────────────────────────

  it('falls back to CLI when runtime returns TOOL_NOT_FOUND', async () => {
    const toolNotFound: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.TOOL_NOT_FOUND, message: 'Tool not registered' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(toolNotFound)),
    );
    mockCliRunner.mockResolvedValue(cliSuccess('handled via cli'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(true);
    expect(mockCliRunner).toHaveBeenCalledOnce();
  });

  // ───────────────────────────────────────────────
  // Existing behavior: successful runtime result bypasses CLI
  // ───────────────────────────────────────────────

  it('returns runtime success without CLI fallback', async () => {
    const runtimeSuccess: ToolOutput = {
      success: true,
      data: { wu: 'WU-1' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(runtimeSuccess)),
    );

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(true);
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // Generic runtime failure (unknown error code) falls back to CLI
  // ───────────────────────────────────────────────

  it('falls back to CLI for generic runtime failures with no recognized error code', async () => {
    const genericFailure: ToolOutput = {
      success: false,
      error: { code: 'UNKNOWN_ERROR', message: 'Something unexpected' },
    };
    const runtimeFactory = vi.fn().mockResolvedValue(
      mockRuntime(vi.fn().mockResolvedValue(genericFailure)),
    );
    mockCliRunner.mockResolvedValue(cliSuccess('cli handled it'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(true);
    expect(mockCliRunner).toHaveBeenCalledOnce();
  });
});

describe('NON_FALLBACK_ERROR_CODES (WU-1859)', () => {
  it('includes POLICY_DENIED, SCOPE_DENIED, and SPEC_TAMPERED', () => {
    expect(NON_FALLBACK_ERROR_CODES).toContain(TOOL_ERROR_CODES.POLICY_DENIED);
    expect(NON_FALLBACK_ERROR_CODES).toContain(TOOL_ERROR_CODES.SCOPE_DENIED);
    expect(NON_FALLBACK_ERROR_CODES).toContain('SPEC_TAMPERED');
  });

  it('does not include TOOL_NOT_FOUND', () => {
    expect(NON_FALLBACK_ERROR_CODES).not.toContain(TOOL_ERROR_CODES.TOOL_NOT_FOUND);
  });
});

describe('DEFAULT_MAINTENANCE_SCOPE (WU-1859)', () => {
  it('uses a narrowed scope pattern instead of wildcard write', () => {
    // The maintenance scope should NOT be unrestricted wildcard write
    const isUnrestrictedWrite =
      DEFAULT_MAINTENANCE_SCOPE.pattern === '**' && DEFAULT_MAINTENANCE_SCOPE.access === 'write';
    expect(isUnrestrictedWrite).toBe(false);
  });
});

describe('buildExecutionContext', () => {
  it('builds a valid execution context with defaults', () => {
    const ctx = buildExecutionContext();
    expect(ctx.task_id).toMatch(/^maintenance-/);
    expect(ctx.run_id).toMatch(/^run-/);
    expect(ctx.session_id).toMatch(/^session-maintenance-/);
    expect(ctx.allowed_scopes).toHaveLength(1);
  });

  it('uses provided taskId and marks as task mode', () => {
    const ctx = buildExecutionContext({ taskId: 'WU-99' });
    expect(ctx.task_id).toBe('WU-99');
    expect(ctx.metadata?.invocation_mode).toBe('task');
  });

  it('marks maintenance mode when no taskId provided', () => {
    const ctx = buildExecutionContext();
    expect(ctx.metadata?.invocation_mode).toBe('maintenance');
  });
});
