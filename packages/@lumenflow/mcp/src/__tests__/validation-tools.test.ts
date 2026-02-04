/**
 * @file validation-tools.test.ts
 * @description Tests for validation MCP tool implementations
 *
 * WU-1426: MCP tools for validate, validate_agent_skills, validate_agent_sync,
 * validate_backlog_sync, validate_skills_spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateTool,
  validateAgentSkillsTool,
  validateAgentSyncTool,
  validateBacklogSyncTool,
  validateSkillsSpecTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('Validation MCP tools (WU-1426)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validate', () => {
    it('should validate all WUs via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'All WUs valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await validateTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should validate specific WU when id provided', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU-1426 is valid',
        stderr: '',
        exitCode: 0,
      });

      await validateTool.execute({ id: 'WU-1426' });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate',
        expect.arrayContaining(['--id', 'WU-1426']),
        expect.any(Object),
      );
    });

    it('should pass strict flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Validation passed',
        stderr: '',
        exitCode: 0,
      });

      await validateTool.execute({ strict: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate',
        expect.arrayContaining(['--strict']),
        expect.any(Object),
      );
    });

    it('should pass done_only flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Done WUs valid',
        stderr: '',
        exitCode: 0,
      });

      await validateTool.execute({ done_only: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate',
        expect.arrayContaining(['--done-only']),
        expect.any(Object),
      );
    });

    it('should return error on validation failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Validation errors found',
        exitCode: 1,
      });

      const result = await validateTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Validation');
    });
  });

  describe('validate_agent_skills', () => {
    it('should validate agent skills via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'All skills valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await validateAgentSkillsTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate:agent-skills',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should validate specific skill when provided', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Skill wu-lifecycle valid',
        stderr: '',
        exitCode: 0,
      });

      await validateAgentSkillsTool.execute({ skill: 'wu-lifecycle' });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate:agent-skills',
        expect.arrayContaining(['--skill', 'wu-lifecycle']),
        expect.any(Object),
      );
    });

    it('should return error on validation failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Skill validation failed',
        exitCode: 1,
      });

      const result = await validateAgentSkillsTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('validate_agent_sync', () => {
    it('should validate agent sync via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Agent sync valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await validateAgentSyncTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate:agent-sync',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on validation failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Agent sync validation failed',
        exitCode: 1,
      });

      const result = await validateAgentSyncTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('validate_backlog_sync', () => {
    it('should validate backlog sync via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Backlog sync valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await validateBacklogSyncTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate:backlog-sync',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on validation failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Backlog sync validation failed',
        exitCode: 1,
      });

      const result = await validateBacklogSyncTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('validate_skills_spec', () => {
    it('should validate skills spec via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Skills spec valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await validateSkillsSpecTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'validate:skills-spec',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on validation failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Skills spec validation failed',
        exitCode: 1,
      });

      const result = await validateSkillsSpecTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });
});
