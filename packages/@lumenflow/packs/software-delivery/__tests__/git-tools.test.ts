// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { delegationToolCapabilities } from '../tools/delegation-tools.js';
import { gitToolCapabilities } from '../tools/git-tools.js';
import { worktreeToolCapabilities } from '../tools/worktree-tools.js';
import { runGitToolThroughToolHost } from '../tool-impl/git-tools.js';
import { loadToolImplementation } from '../tool-impl/worker-loader.js';

const EXPECTED_GIT_TOOL_NAMES = ['git:add', 'git:status', 'git:commit'] as const;

async function runTool(
  toolName: (typeof EXPECTED_GIT_TOOL_NAMES)[number],
  input: Record<string, unknown>,
  cwd: string,
) {
  return runGitToolThroughToolHost({
    toolName,
    input,
    context: {
      run_id: 'run-1734',
      task_id: 'WU-1734',
      session_id: 'session-1734',
      cwd,
    },
  });
}

async function setupGitRepository(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lumenflow-pack-git-'));
  await runTool('git:status', { init: true }, repoRoot);
  await runTool('git:add', { files: [] }, repoRoot);

  await runGitToolThroughToolHost({
    toolName: 'git:status',
    input: {
      commands: [
        ['git', 'config', 'user.email', 'ci@lumenflow.dev'],
        ['git', 'config', 'user.name', 'LumenFlow Bot'],
      ],
    },
    context: {
      run_id: 'run-1734-init',
      task_id: 'WU-1734',
      session_id: 'session-1734',
      cwd: repoRoot,
    },
  });

  await writeFile(path.join(repoRoot, 'tracked.txt'), 'initial\n', 'utf8');
  await runTool('git:add', { files: ['tracked.txt'] }, repoRoot);
  await runTool(
    'git:commit',
    { message: 'chore: initial commit', files: ['tracked.txt'] },
    repoRoot,
  );
  await writeFile(path.join(repoRoot, 'tracked.txt'), 'changed\n', 'utf8');
  return repoRoot;
}

describe('software delivery git tool pack', () => {
  it('uses subprocess descriptors with tool-impl entry strings', () => {
    const descriptors = [
      ...gitToolCapabilities,
      ...delegationToolCapabilities,
      ...worktreeToolCapabilities,
    ];

    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      expect(descriptor.handler.kind).toBe('subprocess');
      expect(descriptor.handler.entry.includes('tool-impl/')).toBe(true);
    }
  });

  it('keeps descriptor files free of fs/child_process imports', async () => {
    const sourceFiles = [
      path.resolve('packages/@lumenflow/packs/software-delivery/tools/git-tools.ts'),
      path.resolve('packages/@lumenflow/packs/software-delivery/tools/lane-lock-tool.ts'),
      path.resolve('packages/@lumenflow/packs/software-delivery/tools/delegation-tools.ts'),
      path.resolve('packages/@lumenflow/packs/software-delivery/tools/worktree-tools.ts'),
    ];

    for (const sourceFile of sourceFiles) {
      const source = await readFile(sourceFile, 'utf8');
      expect(source.includes('node:fs')).toBe(false);
      expect(source.includes('node:child_process')).toBe(false);
    }
  });

  it('runs git tools through tool host and includes artifacts_written for git:commit', async () => {
    const repoRoot = await setupGitRepository();
    const receipt = await runTool(
      'git:commit',
      {
        message: 'feat: commit via pack',
        files: ['tracked.txt'],
      },
      repoRoot,
    );

    expect(receipt.started.tool_name).toBe('git:commit');
    expect(receipt.finished.result).toBe('success');
    expect(receipt.finished.artifacts_written).toContain('tracked.txt');
  });

  it('only allows worker caller to load tool-impl entries', async () => {
    const entry = 'tool-impl/git-tools.ts#gitCommitTool';

    await expect(
      loadToolImplementation({
        entry,
        caller: 'host',
      }),
    ).rejects.toThrow('worker');

    await expect(
      loadToolImplementation({
        entry,
        caller: 'worker',
      }),
    ).resolves.toBeTypeOf('function');
  });

  it('rejects command arrays that try to execute non-git binaries', async () => {
    const repoRoot = await setupGitRepository();
    const markerPath = path.join(repoRoot, 'injected.txt');

    const receipt = await runTool(
      'git:status',
      {
        commands: [['/bin/sh', '-c', `echo injected > ${markerPath}`]],
      },
      repoRoot,
    );

    expect(receipt.output.success).toBe(false);
    expect(receipt.output.error?.code).toBe('invalid_command');
    await expect(readFile(markerPath, 'utf8')).rejects.toThrow();
  });
});
