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

    // WU-1455: initiative_list uses format field from shared schema
    it('should use --format json flag for CLI parity (WU-1455)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify([]),
        stderr: '',
        exitCode: 0,
      });

      await initiativeListTool.execute({ format: 'json' });

      const calledArgs = mockRunCliCommand.mock.calls[0][1] as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
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

    // WU-1455: initiative_status uses format field from shared schema
    it('should use --format json flag for CLI parity (WU-1455)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ id: 'INIT-001' }),
        stderr: '',
        exitCode: 0,
      });

      await initiativeStatusTool.execute({ id: 'INIT-001', format: 'json' });

      const calledArgs = mockRunCliCommand.mock.calls[0][1] as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
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

      // WU-1455: shared schema requires id, slug, title
      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        slug: 'new-initiative',
        title: 'New Initiative',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:create',
        expect.arrayContaining([
          '--id',
          'INIT-003',
          '--slug',
          'new-initiative',
          '--title',
          'New Initiative',
        ]),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiativeCreateTool.execute({
        slug: 'missing-id',
        title: 'Missing ID',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should require title parameter', async () => {
      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        slug: 'missing-title',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('title');
    });

    it('should support optional fields', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Created INIT-003',
        stderr: '',
        exitCode: 0,
      });

      // WU-1455: shared schema supports priority, owner, target_date
      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        slug: 'new-initiative',
        title: 'New Initiative',
        priority: 'P1',
        owner: 'tom@hellm.ai',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:create',
        expect.arrayContaining(['--priority', 'P1', '--owner', 'tom@hellm.ai']),
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

      // WU-1455: shared schema matches CLI fields (status, description, etc.)
      const result = await initiativeEditTool.execute({
        id: 'INIT-001',
        description: 'Updated description',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:edit',
        expect.arrayContaining([
          '--id',
          'INIT-001',
          '--description',
          'Updated description',
          '--status',
          'in_progress',
        ]),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await initiativeEditTool.execute({ description: 'New desc' });

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
    it('should bulk assign WUs to initiative via CLI shell-out (dry-run)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '3 WUs would be assigned',
        stderr: '',
        exitCode: 0,
      });

      // WU-1455: shared schema has no required fields (defaults to dry-run)
      const result = await initiatiBulkAssignTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should support config and apply parameters', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '5 WUs assigned',
        stderr: '',
        exitCode: 0,
      });

      // WU-1455: shared schema uses config, apply, sync_from_initiative
      const result = await initiatiBulkAssignTool.execute({
        config: 'tools/config/custom.yaml',
        apply: true,
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.arrayContaining(['--config', 'tools/config/custom.yaml', '--apply']),
        expect.any(Object),
      );
    });

    it('should support sync_from_initiative parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Reconciled WUs',
        stderr: '',
        exitCode: 0,
      });

      const result = await initiatiBulkAssignTool.execute({
        sync_from_initiative: 'INIT-001',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.arrayContaining(['--reconcile-initiative', 'INIT-001']),
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
