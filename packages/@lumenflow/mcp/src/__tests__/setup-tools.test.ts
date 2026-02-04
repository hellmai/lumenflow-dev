/**
 * @file setup-tools.test.ts
 * @description Tests for setup/LumenFlow MCP tool implementations
 *
 * WU-1426: MCP tools for lumenflow:init, lumenflow:doctor, lumenflow:integrate,
 * lumenflow:upgrade, docs:sync, sync:templates, release, lumenflow commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lumenflowInitTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowUpgradeTool,
  lumenflowCommandsTool,
  lumenflowDocsSyncTool,
  lumenflowReleaseTool,
  lumenflowSyncTemplatesTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('Setup/LumenFlow MCP tools (WU-1426)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('lumenflow_init', () => {
    it('should initialize LumenFlow via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'LumenFlow initialized',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowInitTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:init',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should pass client flag when provided', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'LumenFlow initialized for Claude',
        stderr: '',
        exitCode: 0,
      });

      await lumenflowInitTool.execute({ client: 'claude' });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:init',
        expect.arrayContaining(['--client', 'claude']),
        expect.any(Object),
      );
    });

    it('should pass merge flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'LumenFlow merged',
        stderr: '',
        exitCode: 0,
      });

      await lumenflowInitTool.execute({ merge: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:init',
        expect.arrayContaining(['--merge']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Init failed',
        exitCode: 1,
      });

      const result = await lumenflowInitTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_doctor', () => {
    it('should run doctor diagnostics via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'LumenFlow safety: ACTIVE',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowDoctorTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:doctor',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on diagnostic failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Doctor found issues',
        exitCode: 1,
      });

      const result = await lumenflowDoctorTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Doctor');
    });
  });

  describe('lumenflow_integrate', () => {
    it('should generate enforcement hooks via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Hooks generated',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowIntegrateTool.execute({ client: 'claude-code' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:integrate',
        expect.arrayContaining(['--client', 'claude-code']),
        expect.any(Object),
      );
    });

    it('should require client parameter', async () => {
      const result = await lumenflowIntegrateTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('client');
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Integration failed',
        exitCode: 1,
      });

      const result = await lumenflowIntegrateTool.execute({ client: 'claude-code' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_upgrade', () => {
    it('should upgrade LumenFlow packages via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'LumenFlow upgraded',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowUpgradeTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow:upgrade',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Upgrade failed',
        exitCode: 1,
      });

      const result = await lumenflowUpgradeTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_commands', () => {
    it('should list available CLI commands via shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'wu:claim, wu:done, gates',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowCommandsTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'lumenflow',
        expect.arrayContaining(['commands']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Commands list failed',
        exitCode: 1,
      });

      const result = await lumenflowCommandsTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_docs_sync', () => {
    it('should sync agent docs via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Docs synced',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowDocsSyncTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'docs:sync',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Docs sync failed',
        exitCode: 1,
      });

      const result = await lumenflowDocsSyncTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_release', () => {
    it('should run release workflow via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Release complete',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowReleaseTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'release',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should pass dry_run flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Dry run complete',
        stderr: '',
        exitCode: 0,
      });

      await lumenflowReleaseTool.execute({ dry_run: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'release',
        expect.arrayContaining(['--dry-run']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Release failed',
        exitCode: 1,
      });

      const result = await lumenflowReleaseTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('lumenflow_sync_templates', () => {
    it('should sync templates via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Templates synced',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowSyncTemplatesTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'sync:templates',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Template sync failed',
        exitCode: 1,
      });

      const result = await lumenflowSyncTemplatesTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });
});
