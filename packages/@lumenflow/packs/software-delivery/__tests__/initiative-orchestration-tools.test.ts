// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());
const runtimeRunMock = vi.hoisted(() => vi.fn());

vi.mock('../tool-impl/runtime-cli-adapter.js', async () => {
  const actual = await vi.importActual('../tool-impl/runtime-cli-adapter.js');
  return {
    ...actual,
    runtimeCliAdapter: {
      run: runtimeRunMock,
    },
  };
});

import {
  cloudConnectTool,
  delegationListTool,
  docsSyncTool,
  initiativeAddWuTool,
  initiativeBulkAssignTool,
  initiativeCreateTool,
  initiativeEditTool,
  initiativeListTool,
  initiativePlanTool,
  initiativeRemoveWuTool,
  initiativeStatusTool,
  initPlanTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowReleaseTool,
  lumenflowTool,
  lumenflowUpgradeTool,
  orchestrateInitiativeTool,
  orchestrateInitStatusTool,
  orchestrateMonitorTool,
  planCreateTool,
  planEditTool,
  planLinkTool,
  planPromoteTool,
  syncTemplatesTool,
  workspaceInitTool,
} from '../tool-impl/initiative-orchestration-tools.js';

const INITIATIVE_ADD_WU_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-add-wu.js',
);
const INITIATIVE_BULK_ASSIGN_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-bulk-assign-wus.js',
);
const INITIATIVE_CREATE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-create.js',
);
const INITIATIVE_EDIT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-edit.js',
);
const INITIATIVE_LIST_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-list.js',
);
const INITIATIVE_PLAN_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-plan.js',
);
const INITIATIVE_REMOVE_WU_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-remove-wu.js',
);
const INITIATIVE_STATUS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/initiative-status.js',
);
const ORCHESTRATE_INIT_STATUS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/orchestrate-init-status.js',
);
const ORCHESTRATE_INITIATIVE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/orchestrate-initiative.js',
);
const ORCHESTRATE_MONITOR_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/orchestrate-monitor.js',
);
const PLAN_CREATE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/plan-create.js',
);
const PLAN_EDIT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/plan-edit.js',
);
const PLAN_LINK_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/plan-link.js',
);
const PLAN_PROMOTE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/plan-promote.js',
);
const DELEGATION_LIST_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/delegation-list.js',
);
const DOCS_SYNC_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/docs-sync.js',
);
const LUMENFLOW_INIT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/init.js',
);
const LUMENFLOW_DOCTOR_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/doctor.js',
);
const LUMENFLOW_INTEGRATE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/commands/integrate.js',
);
const LUMENFLOW_RELEASE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/release.js',
);
const LUMENFLOW_UPGRADE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/lumenflow-upgrade.js',
);
const WORKSPACE_INIT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/workspace-init.js',
);
const SYNC_TEMPLATES_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/sync-templates.js',
);

describe('initiative/orchestration tool adapters (WU-1897)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    runtimeRunMock.mockReset();
    runtimeRunMock.mockImplementation(async (command: string, args: string[]) => {
      const scriptPath = path.resolve(process.cwd(), `packages/@lumenflow/cli/dist/${command}.js`);
      const result = spawnSyncMock(process.execPath, [scriptPath, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      return {
        ok: result.status === 0 && !result.error,
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        executionError: result.error?.message,
      };
    });
  });

  it('maps initiative lifecycle arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      error: undefined,
    });

    await initiativeListTool({ status: 'in_progress', format: 'json' });
    await initiativeStatusTool({ id: 'INIT-030', format: 'json' });
    await initiativeCreateTool({
      id: 'INIT-030',
      slug: 'runtime-adoption',
      title: 'KernelRuntime adoption',
    });
    await initiativeEditTool({ id: 'INIT-030', description: 'updated' });
    await initiativeAddWuTool({ initiative: 'INIT-030', wu: 'WU-1897', phase: 6 });
    await initiativeRemoveWuTool({ initiative: 'INIT-030', wu: 'WU-1897' });
    await initiativeBulkAssignTool({ apply: true });
    await initiativePlanTool({ initiative: 'INIT-030', create: true });
    await initPlanTool({ initiative: 'INIT-030', create: true });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [INITIATIVE_LIST_SCRIPT_PATH, '--status', 'in_progress', '--format', 'json'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [INITIATIVE_STATUS_SCRIPT_PATH, '--id', 'INIT-030', '--format', 'json'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        INITIATIVE_CREATE_SCRIPT_PATH,
        '--id',
        'INIT-030',
        '--slug',
        'runtime-adoption',
        '--title',
        'KernelRuntime adoption',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [INITIATIVE_EDIT_SCRIPT_PATH, '--id', 'INIT-030', '--description', 'updated'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [
        INITIATIVE_ADD_WU_SCRIPT_PATH,
        '--initiative',
        'INIT-030',
        '--wu',
        'WU-1897',
        '--phase',
        '6',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      6,
      process.execPath,
      [INITIATIVE_REMOVE_WU_SCRIPT_PATH, '--initiative', 'INIT-030', '--wu', 'WU-1897'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      7,
      process.execPath,
      [INITIATIVE_BULK_ASSIGN_SCRIPT_PATH, '--apply'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      8,
      process.execPath,
      [INITIATIVE_PLAN_SCRIPT_PATH, '--initiative', 'INIT-030', '--create'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      9,
      process.execPath,
      [INITIATIVE_PLAN_SCRIPT_PATH, '--initiative', 'INIT-030', '--create'],
      expect.any(Object),
    );
  });

  it('maps orchestrate and plan arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      error: undefined,
    });

    await orchestrateInitStatusTool({ initiative: 'INIT-030' });
    await orchestrateInitiativeTool({ initiative: 'INIT-030', dry_run: true });
    await orchestrateMonitorTool({ threshold: 90, recover: true, dry_run: true });
    await planCreateTool({ id: 'WU-1897', title: 'Migration plan' });
    await planEditTool({ id: 'WU-1897', section: 'goal', append: 'line' });
    await planLinkTool({ id: 'WU-1897', plan: 'lumenflow://plans/WU-1897.md' });
    await planPromoteTool({ id: 'WU-1897', force: true });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [ORCHESTRATE_INIT_STATUS_SCRIPT_PATH, '--initiative', 'INIT-030'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [ORCHESTRATE_INITIATIVE_SCRIPT_PATH, '--initiative', 'INIT-030', '--dry-run'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [ORCHESTRATE_MONITOR_SCRIPT_PATH, '--threshold', '90', '--recover', '--dry-run'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [PLAN_CREATE_SCRIPT_PATH, '--id', 'WU-1897', '--title', 'Migration plan'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [PLAN_EDIT_SCRIPT_PATH, '--id', 'WU-1897', '--section', 'goal', '--append', 'line'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      6,
      process.execPath,
      [PLAN_LINK_SCRIPT_PATH, '--id', 'WU-1897', '--plan', 'lumenflow://plans/WU-1897.md'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      7,
      process.execPath,
      [PLAN_PROMOTE_SCRIPT_PATH, '--id', 'WU-1897', '--force'],
      expect.any(Object),
    );
  });

  it('maps setup/coordination arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      error: undefined,
    });

    await delegationListTool({ wu: 'WU-1897', json: true });
    await docsSyncTool({ vendor: 'claude', force: true });
    await cloudConnectTool({
      endpoint: 'https://api.hellm.ai',
      org_id: 'ORG-01',
      project_id: 'PROJ-42',
      token_env: 'LUMENFLOW_TOKEN',
      policy_mode: 'strict',
      sync_interval: 60,
      output: '.',
      force: true,
    });
    await workspaceInitTool({ yes: true, output: '.', force: true });
    await lumenflowTool({ client: 'codex-cli', merge: true });
    await lumenflowTool({});
    await lumenflowDoctorTool({});
    await lumenflowIntegrateTool({ client: 'codex-cli' });
    await lumenflowReleaseTool({ dry_run: true });
    await lumenflowUpgradeTool({});
    await syncTemplatesTool({ dry_run: true, verbose: true, check_drift: true });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [DELEGATION_LIST_SCRIPT_PATH, '--wu', 'WU-1897', '--json'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [DOCS_SYNC_SCRIPT_PATH, '--vendor', 'claude', '--force'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        LUMENFLOW_INIT_SCRIPT_PATH,
        'cloud:connect',
        '--endpoint',
        'https://api.hellm.ai',
        '--org-id',
        'ORG-01',
        '--project-id',
        'PROJ-42',
        '--token-env',
        'LUMENFLOW_TOKEN',
        '--policy-mode',
        'strict',
        '--sync-interval',
        '60',
        '--output',
        '.',
        '--force',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [WORKSPACE_INIT_SCRIPT_PATH, '--yes', '--output', '.', '--force'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [LUMENFLOW_INIT_SCRIPT_PATH, '--client', 'codex-cli', '--merge'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      6,
      process.execPath,
      [LUMENFLOW_INIT_SCRIPT_PATH, 'commands'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      7,
      process.execPath,
      [LUMENFLOW_DOCTOR_SCRIPT_PATH],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      8,
      process.execPath,
      [LUMENFLOW_INTEGRATE_SCRIPT_PATH, '--client', 'codex-cli'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      9,
      process.execPath,
      [LUMENFLOW_RELEASE_SCRIPT_PATH, '--dry-run'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      10,
      process.execPath,
      [LUMENFLOW_UPGRADE_SCRIPT_PATH],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      11,
      process.execPath,
      [SYNC_TEMPLATES_SCRIPT_PATH, '--dry-run', '--verbose', '--check-drift'],
      expect.any(Object),
    );
  });

  it('requires identifier fields for required commands', async () => {
    const missingInitiativeStatusId = await initiativeStatusTool({});
    const missingInitiative = await initiativeAddWuTool({ wu: 'WU-1897' });
    const missingWu = await initiativeAddWuTool({ initiative: 'INIT-030' });
    const missingPlanId = await planPromoteTool({});
    const missingDelegationTarget = await delegationListTool({});
    const missingCloudConnectEndpoint = await cloudConnectTool({
      org_id: 'ORG-01',
      project_id: 'PROJ-42',
    });

    expect(missingInitiativeStatusId.success).toBe(false);
    expect(missingInitiativeStatusId.error?.code).toBe('MISSING_PARAMETER');
    expect(missingInitiative.success).toBe(false);
    expect(missingInitiative.error?.code).toBe('MISSING_PARAMETER');
    expect(missingWu.success).toBe(false);
    expect(missingWu.error?.code).toBe('MISSING_PARAMETER');
    expect(missingPlanId.success).toBe(false);
    expect(missingPlanId.error?.code).toBe('MISSING_PARAMETER');
    expect(missingDelegationTarget.success).toBe(false);
    expect(missingDelegationTarget.error?.code).toBe('MISSING_PARAMETER');
    expect(missingCloudConnectEndpoint.success).toBe(false);
    expect(missingCloudConnectEndpoint.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('returns tool-specific errors on subprocess failures', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'initiative:create failed',
      error: undefined,
    });

    const output = await initiativeCreateTool({
      id: 'INIT-030',
      title: 'KernelRuntime adoption',
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('INITIATIVE_CREATE_ERROR');
    expect(output.error?.message).toContain('initiative:create failed');
  });
});
