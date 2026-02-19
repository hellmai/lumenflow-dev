// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());
const coreModuleMock = vi.hoisted(() => ({
  computeWuContext: vi.fn(),
  listWUs: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock('@lumenflow/core', () => coreModuleMock);

import {
  backlogPruneTool,
  configGetTool,
  configSetTool,
  contextGetTool,
  fileDeleteTool,
  fileEditTool,
  fileReadTool,
  fileWriteTool,
  gitBranchTool,
  gitDiffTool,
  gitLogTool,
  laneHealthTool,
  laneSuggestTool,
  lumenflowMetricsTool,
  lumenflowValidateTool,
  signalCleanupTool,
  stateBootstrapTool,
  stateCleanupTool,
  stateDoctorTool,
  validateAgentSkillsTool,
  validateAgentSyncTool,
  validateBacklogSyncTool,
  validateSkillsSpecTool,
  validateTool,
  wuInferLaneTool,
  wuListTool,
} from '../tool-impl/parity-migration-tools.js';

const SCRIPT_PATHS = {
  WU_INFER_LANE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/wu-infer-lane.js'),
  CONFIG_GET: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/config-get.js'),
  CONFIG_SET: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/config-set.js'),
  LANE_HEALTH: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/lane-health.js'),
  LANE_SUGGEST: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/lane-suggest.js'),
  FILE_READ: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/file-read.js'),
  FILE_WRITE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/file-write.js'),
  FILE_EDIT: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/file-edit.js'),
  FILE_DELETE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/file-delete.js'),
  GIT_BRANCH: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/git-branch.js'),
  GIT_DIFF: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/git-diff.js'),
  GIT_LOG: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/git-log.js'),
  STATE_BOOTSTRAP: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/state-bootstrap.js'),
  STATE_CLEANUP: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/state-cleanup.js'),
  STATE_DOCTOR: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/state-doctor.js'),
  BACKLOG_PRUNE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/backlog-prune.js'),
  SIGNAL_CLEANUP: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/signal-cleanup.js'),
  LUMENFLOW_METRICS: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/metrics-cli.js'),
  VALIDATE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/validate.js'),
  LUMENFLOW_VALIDATE: path.resolve(process.cwd(), 'packages/@lumenflow/cli/dist/validate.js'),
  VALIDATE_AGENT_SKILLS: path.resolve(
    process.cwd(),
    'packages/@lumenflow/cli/dist/validate-agent-skills.js',
  ),
  VALIDATE_AGENT_SYNC: path.resolve(
    process.cwd(),
    'packages/@lumenflow/cli/dist/validate-agent-sync.js',
  ),
  VALIDATE_BACKLOG_SYNC: path.resolve(
    process.cwd(),
    'packages/@lumenflow/cli/dist/validate-backlog-sync.js',
  ),
  VALIDATE_SKILLS_SPEC: path.resolve(
    process.cwd(),
    'packages/@lumenflow/cli/dist/validate-skills-spec.js',
  ),
} as const;

describe('parity migration tool adapters (WU-1890)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    coreModuleMock.computeWuContext.mockReset();
    coreModuleMock.listWUs.mockReset();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      error: undefined,
    });
  });

  it('maps file command arguments to CLI flags', async () => {
    await fileReadTool({
      path: 'README.md',
      encoding: 'utf-8',
      start_line: 1,
      end_line: 20,
      max_size: 4096,
    });
    await fileWriteTool({
      path: 'README.md',
      content: 'updated',
      encoding: 'utf-8',
      no_create_dirs: true,
    });
    await fileEditTool({
      path: 'README.md',
      old_string: 'old',
      new_string: 'new',
      replace_all: true,
    });
    await fileDeleteTool({ path: 'README.md', recursive: true, force: true });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [
        SCRIPT_PATHS.FILE_READ,
        '--path',
        'README.md',
        '--encoding',
        'utf-8',
        '--start-line',
        '1',
        '--end-line',
        '20',
        '--max-size',
        '4096',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        SCRIPT_PATHS.FILE_WRITE,
        '--path',
        'README.md',
        '--content',
        'updated',
        '--encoding',
        'utf-8',
        '--no-create-dirs',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        SCRIPT_PATHS.FILE_EDIT,
        '--path',
        'README.md',
        '--old-string',
        'old',
        '--new-string',
        'new',
        '--replace-all',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [SCRIPT_PATHS.FILE_DELETE, '--path', 'README.md', '--recursive', '--force'],
      expect.any(Object),
    );
  });

  it('maps lane and git command arguments to CLI flags', async () => {
    await wuInferLaneTool({ id: 'WU-1890', paths: ['packages/**'], desc: 'tool migration' });
    await laneHealthTool({ json: true, verbose: true, no_coverage: true });
    await laneSuggestTool({
      dry_run: true,
      interactive: true,
      output: 'lanes.yaml',
      json: true,
      no_llm: true,
      include_git: true,
    });
    await gitBranchTool({
      base_dir: '/tmp/repo',
      list: true,
      all: true,
      remotes: true,
      show_current: true,
      contains: 'HEAD',
    });
    await gitDiffTool({
      base_dir: '/tmp/repo',
      staged: true,
      name_only: true,
      stat: true,
      ref: 'HEAD~1',
      path: 'src',
    });
    await gitLogTool({
      base_dir: '/tmp/repo',
      oneline: true,
      max_count: 5,
      format: '%h %s',
      since: '1d',
      author: 'tom',
      ref: 'main',
    });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [
        SCRIPT_PATHS.WU_INFER_LANE,
        '--id',
        'WU-1890',
        '--paths',
        'packages/**',
        '--desc',
        'tool migration',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [SCRIPT_PATHS.LANE_HEALTH, '--json', '--verbose', '--no-coverage'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        SCRIPT_PATHS.LANE_SUGGEST,
        '--dry-run',
        '--interactive',
        '--output',
        'lanes.yaml',
        '--json',
        '--no-llm',
        '--include-git',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [
        SCRIPT_PATHS.GIT_BRANCH,
        '--base-dir',
        '/tmp/repo',
        '--list',
        '--all',
        '--remotes',
        '--show-current',
        '--contains',
        'HEAD',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [
        SCRIPT_PATHS.GIT_DIFF,
        '--base-dir',
        '/tmp/repo',
        '--staged',
        '--name-only',
        '--stat',
        'HEAD~1',
        '--',
        'src',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      6,
      process.execPath,
      [
        SCRIPT_PATHS.GIT_LOG,
        '--base-dir',
        '/tmp/repo',
        '--oneline',
        '-n',
        '5',
        '--format',
        '%h %s',
        '--since',
        '1d',
        '--author',
        'tom',
        'main',
      ],
      expect.any(Object),
    );
  });

  it('maps state/backlog/signal/validation command arguments to CLI flags', async () => {
    await stateBootstrapTool({
      execute: true,
      dry_run: true,
      force: true,
      wu_dir: 'docs/wu',
      state_dir: '.lumenflow/state',
    });
    await stateCleanupTool({
      dry_run: true,
      signals_only: true,
      memory_only: true,
      events_only: true,
      json: true,
      quiet: true,
      base_dir: '/tmp/repo',
    });
    await stateDoctorTool({
      fix: true,
      dry_run: true,
      json: true,
      quiet: true,
      base_dir: '/tmp/repo',
    });
    await backlogPruneTool({
      execute: true,
      dry_run: true,
      stale_days_in_progress: 7,
      stale_days_ready: 14,
      archive_days: 30,
    });
    await signalCleanupTool({
      dry_run: true,
      ttl: '30d',
      unread_ttl: '7d',
      max_entries: 100,
      json: true,
      quiet: true,
      base_dir: '/tmp/repo',
    });
    await validateTool({ id: 'WU-1890', strict: true, done_only: true });
    await validateAgentSkillsTool({ skill: 'wu-lifecycle' });
    await validateAgentSyncTool({});
    await validateBacklogSyncTool({});
    await validateSkillsSpecTool({});

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [
        SCRIPT_PATHS.STATE_BOOTSTRAP,
        '--execute',
        '--dry-run',
        '--force',
        '--wu-dir',
        'docs/wu',
        '--state-dir',
        '.lumenflow/state',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        SCRIPT_PATHS.STATE_CLEANUP,
        '--dry-run',
        '--signals-only',
        '--memory-only',
        '--events-only',
        '--json',
        '--quiet',
        '--base-dir',
        '/tmp/repo',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        SCRIPT_PATHS.STATE_DOCTOR,
        '--fix',
        '--dry-run',
        '--json',
        '--quiet',
        '--base-dir',
        '/tmp/repo',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [
        SCRIPT_PATHS.BACKLOG_PRUNE,
        '--execute',
        '--dry-run',
        '--stale-days-in-progress',
        '7',
        '--stale-days-ready',
        '14',
        '--archive-days',
        '30',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [
        SCRIPT_PATHS.SIGNAL_CLEANUP,
        '--dry-run',
        '--ttl',
        '30d',
        '--unread-ttl',
        '7d',
        '--max-entries',
        '100',
        '--json',
        '--quiet',
        '--base-dir',
        '/tmp/repo',
      ],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      6,
      process.execPath,
      [SCRIPT_PATHS.VALIDATE, '--id', 'WU-1890', '--strict', '--done-only'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      7,
      process.execPath,
      [SCRIPT_PATHS.VALIDATE_AGENT_SKILLS, '--skill', 'wu-lifecycle'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      8,
      process.execPath,
      [SCRIPT_PATHS.VALIDATE_AGENT_SYNC],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      9,
      process.execPath,
      [SCRIPT_PATHS.VALIDATE_BACKLOG_SYNC],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      10,
      process.execPath,
      [SCRIPT_PATHS.VALIDATE_SKILLS_SPEC],
      expect.any(Object),
    );
  });

  it('maps config/metrics aliases and delegates context/list to core handlers', async () => {
    coreModuleMock.computeWuContext.mockResolvedValue({ location: { type: 'main' } });
    coreModuleMock.listWUs.mockResolvedValue([{ id: 'WU-1890', status: 'in_progress' }]);

    const contextResult = await contextGetTool({});
    const wuListResult = await wuListTool({
      status: 'in_progress',
      lane: 'Framework: Core Lifecycle',
    });
    await configSetTool({ key: 'methodology.testing', value: 'tdd' });
    await configGetTool({ key: 'methodology.testing' });
    await lumenflowMetricsTool({ subcommand: 'flow', days: 7, format: 'json' });
    await lumenflowValidateTool({ id: 'WU-1890', strict: true, done_only: true });

    expect(contextResult).toMatchObject({
      success: true,
      data: { location: { type: 'main' } },
    });
    expect(wuListResult).toMatchObject({
      success: true,
      data: [{ id: 'WU-1890', status: 'in_progress' }],
    });
    expect(coreModuleMock.computeWuContext).toHaveBeenCalledWith({
      cwd: process.cwd(),
    });
    expect(coreModuleMock.listWUs).toHaveBeenCalledWith({
      projectRoot: process.cwd(),
      status: 'in_progress',
      lane: 'Framework: Core Lifecycle',
    });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [SCRIPT_PATHS.CONFIG_SET, '--key', 'methodology.testing', '--value', 'tdd'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [SCRIPT_PATHS.CONFIG_GET, '--key', 'methodology.testing'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [SCRIPT_PATHS.LUMENFLOW_METRICS, 'flow', '--days', '7', '--format', 'json'],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [SCRIPT_PATHS.LUMENFLOW_VALIDATE, '--id', 'WU-1890', '--strict', '--done-only'],
      expect.any(Object),
    );
  });

  it('returns missing-parameter errors for required file inputs', async () => {
    const missingRead = await fileReadTool({});
    const missingWrite = await fileWriteTool({ path: 'README.md' });
    const missingEdit = await fileEditTool({ path: 'README.md', old_string: 'old' });
    const missingDelete = await fileDeleteTool({});
    const missingConfigGet = await configGetTool({});
    const missingConfigSetMissingKey = await configSetTool({ value: 'tdd' });
    const missingConfigSetMissingValue = await configSetTool({ key: 'methodology.testing' });

    expect(missingRead).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'path is required' },
    });
    expect(missingWrite).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'content is required' },
    });
    expect(missingEdit).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'new_string is required' },
    });
    expect(missingDelete).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'path is required' },
    });
    expect(missingConfigGet).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'key is required' },
    });
    expect(missingConfigSetMissingKey).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'key is required' },
    });
    expect(missingConfigSetMissingValue).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'value is required' },
    });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
