/**
 * @file tools-shared.test.ts
 * @description Tests for executeViaPack fallback policy and maintenance scope.
 *
 * WU-1866: Flipped from NON_FALLBACK_ERROR_CODES denylist to
 * FALLBACK_ALLOWED_ERROR_CODES allowlist. Only TOOL_NOT_FOUND (and runtime
 * init failures) trigger CLI fallback. All other error codes and thrown
 * exceptions return directly -- default-deny for fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOL_ERROR_CODES, type ToolOutput } from '@lumenflow/kernel';
import {
  executeViaPack,
  buildExecutionContext,
  resetExecuteViaPackRuntimeCache,
  type ExecuteViaPackOptions,
  FALLBACK_ALLOWED_ERROR_CODES,
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

describe('executeViaPack allowlist fallback policy (WU-1866)', () => {
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
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(policyDenied)));

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
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(scopeDenied)));

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
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(specTampered)));

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
      migrationCompatMode: 'compat',
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
      migrationCompatMode: 'compat',
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
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(toolNotFound)));
    mockCliRunner.mockResolvedValue(cliSuccess('handled via cli'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
      migrationCompatMode: 'compat',
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
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(runtimeSuccess)));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(true);
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // WU-1866: Unknown/future error codes return directly (allowlist behavior)
  // ───────────────────────────────────────────────

  it('returns unknown error codes directly without CLI fallback (default-deny)', async () => {
    const genericFailure: ToolOutput = {
      success: false,
      error: { code: 'UNKNOWN_ERROR', message: 'Something unexpected' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(genericFailure)));
    mockCliRunner.mockResolvedValue(cliSuccess('cli handled it'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_ERROR');
    expect(result.error?.message).toBe('Something unexpected');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  it('returns INVALID_INPUT directly without CLI fallback', async () => {
    const invalidInput: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.INVALID_INPUT, message: 'Bad input' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(invalidInput)));
    mockCliRunner.mockResolvedValue(cliSuccess('should not reach'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(TOOL_ERROR_CODES.INVALID_INPUT);
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  it('returns TOOL_EXECUTION_FAILED directly without CLI fallback', async () => {
    const execFailed: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.TOOL_EXECUTION_FAILED, message: 'Exec failed' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(execFailed)));
    mockCliRunner.mockResolvedValue(cliSuccess('should not reach'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(TOOL_ERROR_CODES.TOOL_EXECUTION_FAILED);
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // WU-1866: Thrown exceptions from executeTool return directly
  // ───────────────────────────────────────────────

  it('returns directly when executeTool throws an exception (no CLI fallback)', async () => {
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(
        mockRuntime(vi.fn().mockRejectedValue(new Error('executeTool crashed unexpectedly'))),
      );
    mockCliRunner.mockResolvedValue(cliSuccess('should not reach'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      runtimeFactory,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('executeTool crashed unexpectedly');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });
});

describe('FALLBACK_ALLOWED_ERROR_CODES (WU-1866)', () => {
  it('contains only TOOL_NOT_FOUND', () => {
    expect(FALLBACK_ALLOWED_ERROR_CODES.has(TOOL_ERROR_CODES.TOOL_NOT_FOUND)).toBe(true);
    expect(FALLBACK_ALLOWED_ERROR_CODES.size).toBe(1);
  });

  it('does not contain POLICY_DENIED, SCOPE_DENIED, or SPEC_TAMPERED', () => {
    expect(FALLBACK_ALLOWED_ERROR_CODES.has(TOOL_ERROR_CODES.POLICY_DENIED)).toBe(false);
    expect(FALLBACK_ALLOWED_ERROR_CODES.has(TOOL_ERROR_CODES.SCOPE_DENIED)).toBe(false);
    expect(FALLBACK_ALLOWED_ERROR_CODES.has('SPEC_TAMPERED')).toBe(false);
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

describe('executeViaPack migration compat guard + telemetry (WU-1886)', () => {
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

  it('disables fallback in strict mode and returns explicit strict error for TOOL_NOT_FOUND', async () => {
    const toolNotFound: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.TOOL_NOT_FOUND, message: 'Tool not registered' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(toolNotFound)));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      migrationCompatMode: 'strict',
      onFallbackTelemetry: vi.fn(),
    } as ExecuteViaPackOptions);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MCP_MIGRATION_FALLBACK_DISABLED');
    expect(result.error?.message).toContain('strict mode');
    expect(mockCliRunner).not.toHaveBeenCalled();
  });

  it('defaults to strict mode when no compat mode or env override is provided', async () => {
    const toolNotFound: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.TOOL_NOT_FOUND, message: 'Tool not registered' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(toolNotFound)));
    mockCliRunner.mockResolvedValue(cliSuccess('unexpected compat fallback'));
    const previousMode = process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE;
    delete process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE;

    try {
      const result = await executeViaPack(toolName, toolInput, {
        ...baseOptions,
        runtimeFactory,
      } as ExecuteViaPackOptions);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MCP_MIGRATION_FALLBACK_DISABLED');
      expect(mockCliRunner).not.toHaveBeenCalled();
    } finally {
      if (previousMode === undefined) {
        delete process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE;
      } else {
        process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE = previousMode;
      }
    }
  });

  it('allows compat mode fallback via env override for emergency rollback', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('runtime init failed'));
    const previousMode = process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE;
    process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE = 'compat';
    mockCliRunner.mockResolvedValue(cliSuccess('fallback succeeded'));

    try {
      const result = await executeViaPack(toolName, toolInput, {
        ...baseOptions,
        runtimeFactory,
      } as ExecuteViaPackOptions);

      expect(result.success).toBe(true);
      expect(mockCliRunner).toHaveBeenCalledOnce();
    } finally {
      if (previousMode === undefined) {
        delete process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE;
      } else {
        process.env.LUMENFLOW_MCP_MIGRATION_COMPAT_MODE = previousMode;
      }
    }
  });

  it('emits structured fallback telemetry with toolName, reason, and workspaceRoot', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('runtime init failed'));
    const onFallbackTelemetry = vi.fn();
    mockCliRunner.mockResolvedValue(cliSuccess('fallback succeeded'));

    const result = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      onFallbackTelemetry,
      migrationCompatMode: 'compat',
    } as ExecuteViaPackOptions);

    expect(result.success).toBe(true);
    expect(onFallbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName,
        reason: 'runtime_init_failed',
        workspaceRoot: projectRoot,
      }),
    );
  });

  it('supports dedicated migration fallback error code only when compat guard is enabled', async () => {
    const dedicatedCode = 'MCP_MIGRATION_FALLBACK_ERROR';
    const toolNotFound: ToolOutput = {
      success: false,
      error: { code: TOOL_ERROR_CODES.TOOL_NOT_FOUND, message: 'Tool not registered' },
    };
    const runtimeFactory = vi
      .fn()
      .mockResolvedValue(mockRuntime(vi.fn().mockResolvedValue(toolNotFound)));

    mockCliRunner.mockResolvedValue(cliFailure('cli failed'));
    const compatResult = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      fallback: {
        ...baseOptions.fallback,
        migrationErrorCode: dedicatedCode,
      },
      migrationCompatMode: 'compat',
    } as unknown as ExecuteViaPackOptions);
    expect(compatResult.success).toBe(false);
    expect(compatResult.error?.code).toBe(dedicatedCode);

    mockCliRunner.mockClear();
    const strictResult = await executeViaPack(toolName, toolInput, {
      ...baseOptions,
      fallback: {
        ...baseOptions.fallback,
        migrationErrorCode: dedicatedCode,
      },
      migrationCompatMode: 'strict',
    } as unknown as ExecuteViaPackOptions);

    expect(strictResult.success).toBe(false);
    expect(strictResult.error?.code).toBe('MCP_MIGRATION_FALLBACK_DISABLED');
    expect(strictResult.error?.code).not.toBe(dedicatedCode);
    expect(mockCliRunner).not.toHaveBeenCalled();
  });
});
