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
  backlogPruneTool,
  docsSyncTool,
  stateDoctorTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import * as toolsShared from '../tools-shared.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

vi.mock('../tools-shared.js', async () => {
  const actual = await vi.importActual<typeof import('../tools-shared.js')>('../tools-shared.js');
  return {
    ...actual,
    executeViaPack: vi.fn(actual.executeViaPack),
  };
});

describe('Initiative MCP tools (WU-1424)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiative_list', () => {
    it('should list initiatives via executeViaPack', async () => {
      const mockInitiatives = [
        { id: 'INIT-001', title: 'MCP Server', status: 'active' },
        { id: 'INIT-002', title: 'Memory Layer', status: 'completed' },
      ];
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: mockInitiatives,
      });

      const result = await initiativeListTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockInitiatives);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:list',
        expect.objectContaining({}),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:list',
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support status filter', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: [{ id: 'INIT-001', status: 'active' }],
      });

      const result = await initiativeListTool.execute({ status: 'active' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:list',
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:list',
            args: expect.arrayContaining(['--status', 'active']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should handle CLI errors', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: false,
        error: { message: 'Failed to list initiatives' },
      });

      const result = await initiativeListTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to list initiatives');
    });

    // WU-1455: initiative_list uses format field from shared schema
    it('should use --format json flag for CLI parity (WU-1455)', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: [],
      });

      await initiativeListTool.execute({ format: 'json' });

      const calledArgs = mockExecuteViaPack.mock.calls[0]?.[2]?.fallback?.args as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
    });
  });

  describe('initiative_status', () => {
    it('should get initiative status via executeViaPack', async () => {
      const mockStatus = {
        id: 'INIT-001',
        title: 'MCP Server',
        status: 'active',
        wus: ['WU-1412', 'WU-1424'],
        progress: { done: 1, total: 5 },
      };
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: mockStatus,
      });

      const result = await initiativeStatusTool.execute({ id: 'INIT-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'INIT-001' });
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:status',
        expect.objectContaining({ id: 'INIT-001' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:status',
            args: expect.arrayContaining(['--id', 'INIT-001']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await initiativeStatusTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    // WU-1455: initiative_status uses format field from shared schema
    it('should use --format json flag for CLI parity (WU-1455)', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { id: 'INIT-001' },
      });

      await initiativeStatusTool.execute({ id: 'INIT-001', format: 'json' });

      const calledArgs = mockExecuteViaPack.mock.calls[0]?.[2]?.fallback?.args as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
    });
  });

  describe('initiative_create', () => {
    it('should create initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Created INIT-003' },
      });

      // WU-1455: shared schema requires id, slug, title
      const result = await initiativeCreateTool.execute({
        id: 'INIT-003',
        slug: 'new-initiative',
        title: 'New Initiative',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:create',
        expect.objectContaining({
          id: 'INIT-003',
          slug: 'new-initiative',
          title: 'New Initiative',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:create',
            args: expect.arrayContaining([
              '--id',
              'INIT-003',
              '--slug',
              'new-initiative',
              '--title',
              'New Initiative',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
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
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Created INIT-003' },
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
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:create',
        expect.objectContaining({
          priority: 'P1',
          owner: 'tom@hellm.ai',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--priority', 'P1', '--owner', 'tom@hellm.ai']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('initiative_edit', () => {
    it('should edit initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Initiative updated' },
      });

      // WU-1455: shared schema matches CLI fields (status, description, etc.)
      const result = await initiativeEditTool.execute({
        id: 'INIT-001',
        description: 'Updated description',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:edit',
        expect.objectContaining({
          id: 'INIT-001',
          description: 'Updated description',
          status: 'in_progress',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:edit',
            args: expect.arrayContaining([
              '--id',
              'INIT-001',
              '--description',
              'Updated description',
              '--status',
              'in_progress',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await initiativeEditTool.execute({ description: 'New desc' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wave-1 ops parity mappings (WU-1482)', () => {
    it('should run backlog_prune with thresholds', async () => {
      mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

      const result = await backlogPruneTool.execute({
        stale_days_in_progress: 7,
        stale_days_ready: 30,
        archive_days: 90,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'backlog:prune',
        expect.objectContaining({
          stale_days_in_progress: 7,
          stale_days_ready: 30,
          archive_days: 90,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'backlog:prune',
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should run docs_sync with force/vendor flags', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Docs synced',
        stderr: '',
        exitCode: 0,
      });

      const result = await docsSyncTool.execute({ force: true, vendor: 'claude' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'docs:sync',
        expect.arrayContaining(['--vendor', 'claude', '--force']),
        expect.any(Object),
      );
    });

    it('should run state_doctor with fix/dry-run flags', async () => {
      mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

      const result = await stateDoctorTool.execute({ fix: true, dry_run: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'state:doctor',
        expect.objectContaining({
          fix: true,
          dry_run: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'state:doctor',
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('initiative_add_wu', () => {
    it('should add WU to initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU added to initiative' },
      });

      const result = await initiativeAddWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:add-wu',
        expect.objectContaining({
          initiative: 'INIT-001',
          wu: 'WU-1424',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:add-wu',
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--wu', 'WU-1424']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
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
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU added to initiative phase 2' },
      });

      const result = await initiativeAddWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
        phase: 2,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:add-wu',
        expect.objectContaining({
          initiative: 'INIT-001',
          wu: 'WU-1424',
          phase: 2,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining([
              '--initiative',
              'INIT-001',
              '--wu',
              'WU-1424',
              '--phase',
              '2',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('initiative_remove_wu', () => {
    it('should remove WU from initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU removed from initiative' },
      });

      const result = await initiativeRemoveWuTool.execute({
        initiative: 'INIT-001',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:remove-wu',
        expect.objectContaining({
          initiative: 'INIT-001',
          wu: 'WU-1424',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:remove-wu',
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--wu', 'WU-1424']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
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
    it('should bulk assign WUs to initiative via executeViaPack (dry-run)', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: '3 WUs would be assigned' },
      });

      // WU-1455: shared schema has no required fields (defaults to dry-run)
      const result = await initiatiBulkAssignTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.objectContaining({}),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:bulk-assign',
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support config and apply parameters', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: '5 WUs assigned' },
      });

      // WU-1455: shared schema uses config, apply, sync_from_initiative
      const result = await initiatiBulkAssignTool.execute({
        config: 'tools/config/custom.yaml',
        apply: true,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.objectContaining({
          config: 'tools/config/custom.yaml',
          apply: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--config', 'tools/config/custom.yaml', '--apply']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support sync_from_initiative parameter', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Reconciled WUs' },
      });

      const result = await initiatiBulkAssignTool.execute({
        sync_from_initiative: 'INIT-001',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:bulk-assign',
        expect.objectContaining({
          sync_from_initiative: 'INIT-001',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--reconcile-initiative', 'INIT-001']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('initiative_plan', () => {
    it('should link plan to initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Plan linked to initiative' },
      });

      const result = await initiativePlanTool.execute({
        initiative: 'INIT-001',
        plan: 'docs/04-operations/plans/init-001-plan.md',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:plan',
        expect.objectContaining({
          initiative: 'INIT-001',
          plan: 'docs/04-operations/plans/init-001-plan.md',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'initiative:plan',
            args: expect.arrayContaining([
              '--initiative',
              'INIT-001',
              '--plan',
              'docs/04-operations/plans/init-001-plan.md',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require initiative parameter', async () => {
      const result = await initiativePlanTool.execute({ plan: 'path/to/plan.md' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });

    it('should support create flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Plan template created and linked' },
      });

      const result = await initiativePlanTool.execute({
        initiative: 'INIT-001',
        create: true,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'initiative:plan',
        expect.objectContaining({
          initiative: 'INIT-001',
          create: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--create']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });
});
