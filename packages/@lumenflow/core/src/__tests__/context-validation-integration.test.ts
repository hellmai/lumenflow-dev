/**
 * @file context-validation-integration.test.ts
 * Tests for context validation integration module
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CONTEXT_VALIDATION, WU_STATUS } from '../wu-constants.js';
import type { WuContext } from '../validation/types.js';

const { LOCATION_TYPES, COMMANDS } = CONTEXT_VALIDATION;

// Mock getConfig
vi.mock('../lumenflow-config.js', () => ({
  getConfig: vi.fn(),
}));

// Mock computeContext
vi.mock('../context/context-computer.js', () => ({
  computeContext: vi.fn(),
}));

// Mock validateCommand
vi.mock('../validation/validate-command.js', () => ({
  validateCommand: vi.fn(),
}));

// Mock getValidCommandsForContext
vi.mock('../validation/command-registry.js', () => ({
  getValidCommandsForContext: vi.fn(),
}));

import { getConfig } from '../lumenflow-config.js';
import { computeContext } from '../context/context-computer.js';
import { validateCommand } from '../validation/validate-command.js';
import { getValidCommandsForContext } from '../validation/command-registry.js';
import {
  getValidationMode,
  shouldShowNextSteps,
  runContextValidation,
  formatNextSteps,
} from '../context-validation-integration.js';

describe('context-validation-integration (WU-1090)', () => {
  const mockContext: WuContext = {
    location: {
      type: LOCATION_TYPES.MAIN,
      cwd: '/repo',
      gitRoot: '/repo',
      mainCheckout: '/repo',
      worktreeName: null,
      worktreeWuId: null,
    },
    git: {
      branch: 'main',
      isDetached: false,
      isDirty: false,
      hasStaged: false,
      ahead: 0,
      behind: 0,
      tracking: null,
      modifiedFiles: [],
      hasError: false,
      errorMessage: null,
    },
    wu: {
      id: 'WU-100',
      status: WU_STATUS.READY,
      lane: 'Operations',
      title: 'Test WU',
      yamlPath: '/repo/docs/04-operations/tasks/wu/WU-100.yaml',
      isConsistent: true,
      inconsistencyReason: null,
    },
    session: { isActive: false, sessionId: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getValidationMode', () => {
    it('returns "warn" when config has context_validation enabled', () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: true,
          validation_mode: 'warn',
        },
      } as never);

      expect(getValidationMode()).toBe('warn');
    });

    it('returns "error" when validation_mode is error', () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: true,
          validation_mode: 'error',
        },
      } as never);

      expect(getValidationMode()).toBe('error');
    });

    it('returns "off" when context_validation is disabled', () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: false,
        },
      } as never);

      expect(getValidationMode()).toBe('off');
    });

    it('returns "warn" when config throws (fallback)', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config not found');
      });

      expect(getValidationMode()).toBe('warn');
    });

    it('returns "off" when experimental config is missing', () => {
      vi.mocked(getConfig).mockReturnValue({} as never);

      expect(getValidationMode()).toBe('off');
    });
  });

  describe('shouldShowNextSteps', () => {
    it('returns true when show_next_steps is true', () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          show_next_steps: true,
        },
      } as never);

      expect(shouldShowNextSteps()).toBe(true);
    });

    it('returns false when show_next_steps is false', () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          show_next_steps: false,
        },
      } as never);

      expect(shouldShowNextSteps()).toBe(false);
    });

    it('returns true when config is missing (default)', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config not found');
      });

      expect(shouldShowNextSteps()).toBe(true);
    });
  });

  describe('runContextValidation', () => {
    it('skips validation when mode is off', async () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: false,
        },
      } as never);

      vi.mocked(computeContext).mockResolvedValue({
        context: mockContext,
        computationMs: 10,
        exceededBudget: false,
      });

      const result = await runContextValidation(COMMANDS.WU_CLAIM, 'WU-100');

      expect(result.canProceed).toBe(true);
      expect(result.mode).toBe('off');
      expect(result.validation).toBeNull();
      expect(validateCommand).not.toHaveBeenCalled();
    });

    it('runs validation and returns result when mode is warn', async () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: true,
          validation_mode: 'warn',
        },
      } as never);

      vi.mocked(computeContext).mockResolvedValue({
        context: mockContext,
        computationMs: 10,
        exceededBudget: false,
      });

      vi.mocked(validateCommand).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
        context: mockContext,
      });

      const result = await runContextValidation(COMMANDS.WU_CLAIM, 'WU-100');

      expect(result.canProceed).toBe(true);
      expect(result.mode).toBe('warn');
      expect(result.validation).not.toBeNull();
      expect(validateCommand).toHaveBeenCalledWith(COMMANDS.WU_CLAIM, mockContext);
    });

    it('allows proceed with warnings in warn mode', async () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: true,
          validation_mode: 'warn',
        },
      } as never);

      vi.mocked(computeContext).mockResolvedValue({
        context: mockContext,
        computationMs: 10,
        exceededBudget: false,
      });

      vi.mocked(validateCommand).mockReturnValue({
        valid: false,
        errors: [{ code: 'WRONG_LOCATION', message: 'Wrong location', fixCommand: 'cd /repo' }],
        warnings: [],
        context: mockContext,
      });

      const result = await runContextValidation(COMMANDS.WU_CLAIM, 'WU-100');

      expect(result.canProceed).toBe(true); // warn mode allows proceed
      expect(result.output).toContain('WRONG_LOCATION');
    });

    it('blocks in error mode when validation fails', async () => {
      vi.mocked(getConfig).mockReturnValue({
        experimental: {
          context_validation: true,
          validation_mode: 'error',
        },
      } as never);

      vi.mocked(computeContext).mockResolvedValue({
        context: mockContext,
        computationMs: 10,
        exceededBudget: false,
      });

      vi.mocked(validateCommand).mockReturnValue({
        valid: false,
        errors: [{ code: 'WRONG_LOCATION', message: 'Wrong location', fixCommand: 'cd /repo' }],
        warnings: [],
        context: mockContext,
      });

      const result = await runContextValidation(COMMANDS.WU_CLAIM, 'WU-100');

      expect(result.canProceed).toBe(false); // error mode blocks
      expect(result.output).toContain('WRONG_LOCATION');
      expect(result.output).toContain('cd /repo');
    });
  });

  describe('formatNextSteps', () => {
    it('returns formatted next steps from command definition', () => {
      vi.mocked(getValidCommandsForContext).mockReturnValue([
        {
          name: COMMANDS.WU_CLAIM,
          description: 'Claim a WU',
          requiredLocation: LOCATION_TYPES.MAIN,
          requiredWuStatus: WU_STATUS.READY,
          getNextSteps: () => ['Step 1: cd worktree', 'Step 2: implement'],
        },
      ]);

      const result = formatNextSteps(mockContext, COMMANDS.WU_CLAIM);

      expect(result).toContain('Next Steps');
      expect(result).toContain('Step 1');
      expect(result).toContain('Step 2');
    });

    it('returns empty string when command has no next steps', () => {
      vi.mocked(getValidCommandsForContext).mockReturnValue([
        {
          name: COMMANDS.WU_STATUS,
          description: 'Show status',
          requiredLocation: null,
          requiredWuStatus: null,
          // No getNextSteps
        },
      ]);

      const result = formatNextSteps(mockContext, COMMANDS.WU_STATUS);

      expect(result).toBe('');
    });

    it('returns empty string when command not in valid commands', () => {
      vi.mocked(getValidCommandsForContext).mockReturnValue([]);

      const result = formatNextSteps(mockContext, COMMANDS.WU_CLAIM);

      expect(result).toBe('');
    });
  });
});
