/**
 * @file initiative-tools.test.ts
 * @description Tests for Initiative MCP tool implementations
 *
 * WU-1424: 8 initiative tools: initiative_list, initiative_status, initiative_create,
 * initiative_edit, initiative_add_wu, initiative_remove_wu, initiative_bulk_assign, initiative_plan
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initiativeListTool,
  initiativeStatusTool,
  initiativeCreateTool,
  initiativeEditTool,
  initiativeAddWuTool,
  initiativeRemoveWuTool,
  initiatiBulkAssignTool,
  initiativePlanTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('Initiative MCP tools (WU-1424)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiative_list', () => {
    it('should list initiatives via CLI shell-out', async () => {
      const mockInitiatives = [
        { id: 'INIT-001', title: 'MCP Server', status: 'active' },
        { id: 'INIT-002', title: 'Memory Layer', status: 'completed' },
      ];
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockInitiatives),
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeListTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockInitiatives);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:list',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should support status filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify([{ id: 'INIT-001', status: 'active' }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeListTool.execute({ status: 'active' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:list',
        expect.arrayContaining(['--status', 'active']),
        expect.any(Object),
      );
    });

    it('should handle CLI errors', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Failed to list initiatives',
        exitCode: 1,
      });

      const result = await initiativeListTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to list initiatives');
    });
  });

  describe('initiative_status', () => {
    it('should get initiative status via CLI shell-out', async () => {
      const mockStatus = {
        id: 'INIT-001',
        title: 'MCP Server',
        status: 'active',
        wus: ['WU-1412', 'WU-1424'],
        progress: { done: 1, total: 5 },
      };
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockStatus),
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeStatusTool.execute({ id: 'INIT-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'INIT-001' });
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:status',
        expect.arrayContaining(['--id', 'INIT-001']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiativeStatusTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('initiative_create', () => {
    it('should create initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Created INIT-003',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        title: 'New Initiative',
        description: 'Test description',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:create',
        expect.arrayContaining(['--id', 'INIT-003', '--title', 'New Initiative']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiativeCreateTool.execute({ title: 'Missing ID' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should require title parameter', async () => {
      const result = await initiativeCreateTool.execute({ id: 'INIT-003' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('title');
    });

    it('should support phases parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Created INIT-003',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        title: 'New Initiative',
        phases: ['Phase 1: MVP', 'Phase 2: Polish'],
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:create',
        expect.arrayContaining(['--phase', 'Phase 1: MVP', '--phase', 'Phase 2: Polish']),
        expect.any(Object),
      );
    });
  });

  describe('initiative_edit', () => {
    it('should edit initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Initiative updated',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeEditTool.execute({
        id: 'INIT-001',
        title: 'Updated Title',
        description: 'Updated description',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:edit',
        expect.arrayContaining(['--id', 'INIT-001', '--title', 'Updated Title']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiativeEditTool.execute({ title: 'New title' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('initiative_add_wu', () => {
    it('should add WU to initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU added to initiative',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeAddWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:add-wu',
        expect.arrayContaining(['--initiative', 'INIT-001', '--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require initiative parameter', async () => {
      const result = await initiativeAddWuTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });

    it('should require wu parameter', async () => {
      const result = await initiativeAddWuTool.execute({ initiative: 'INIT-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support phase parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU added to initiative phase 2',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeAddWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
        phase: 2,
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:add-wu',
        expect.arrayContaining(['--initiative', 'INIT-001', '--wu', 'WU-1424', '--phase', '2']),
        expect.any(Object),
      );
    });
  });

  describe('initiative_remove_wu', () => {
    it('should remove WU from initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU removed from initiative',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativeRemoveWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:remove-wu',
        expect.arrayContaining(['--initiative', 'INIT-001', '--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require initiative parameter', async () => {
      const result = await initiativeRemoveWuTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });

    it('should require wu parameter', async () => {
      const result = await initiativeRemoveWuTool.execute({ initiative: 'INIT-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });
  });

  describe('initiative_bulk_assign', () => {
    it('should bulk assign WUs to initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '3 WUs assigned to initiative',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiatiBulkAssignTool.execute({
        id: 'INIT-001',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.arrayContaining(['--id', 'INIT-001']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiatiBulkAssignTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support pattern parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '5 WUs assigned matching pattern',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiatiBulkAssignTool.execute({
        id: 'INIT-001',
        pattern: 'MCP:*',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.arrayContaining(['--id', 'INIT-001', '--pattern', 'MCP:*']),
        expect.any(Object),
      );
    });
  });

  describe('initiative_plan', () => {
    it('should link plan to initiative via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Plan linked to initiative',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativePlanTool.execute({
        initiative: 'INIT-001',
        plan: 'docs/04-operations/plans/init-001-plan.md',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:plan',
        expect.arrayContaining([
          '--initiative',
          'INIT-001',
          '--plan',
          'docs/04-operations/plans/init-001-plan.md',
        ]),
        expect.any(Object),
      );
    });

    it('should require initiative parameter', async () => {
      const result = await initiativePlanTool.execute({ plan: 'path/to/plan.md' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });

    it('should support create flag', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Plan template created and linked',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiativePlanTool.execute({
        initiative: 'INIT-001',
        create: true,
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:plan',
        expect.arrayContaining(['--initiative', 'INIT-001', '--create']),
        expect.any(Object),
      );
    });
  });
});
