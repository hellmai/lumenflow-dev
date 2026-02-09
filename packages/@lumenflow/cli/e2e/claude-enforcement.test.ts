/**
 * @file claude-enforcement.test.ts
 * End-to-end tests for Claude Code enforcement hooks (WU-1367)
 *
 * These tests verify the full integration flow:
 * 1. Config schema parsing
 * 2. Hook generation via integrate command
 * 3. Hook script functionality
 */

// Test file lint exceptions
/* eslint-disable sonarjs/no-duplicate-string */
// Object injection is expected in tests accessing parsed config properties
/* eslint-disable security/detect-object-injection */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse as parseYAML } from 'yaml';

const CLAUDE_CODE_CLIENT = 'claude-code';
const DOCS_LANE = 'Content: Documentation';

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 240000,
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertCommandSuccess(
  step: string,
  command: string,
  args: string[],
  cwd: string,
  result: CommandResult,
): void {
  if (result.code === 0) {
    return;
  }

  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const tail = combined.split('\n').slice(-40).join('\n');
  throw new Error(
    [
      `${step} failed (${result.code})`,
      `cmd: ${command} ${args.join(' ')}`,
      `cwd: ${cwd}`,
      '--- output (tail) ---',
      tail,
    ].join('\n'),
  );
}

function extractWorktreePath(output: string): string | null {
  const match = output.match(/- Worktree:\s*(.+)/);
  return match ? match[1].trim() : null;
}

function resolveSharedCheckoutRoot(repoRoot: string): string {
  const result = runCommand('git', ['worktree', 'list', '--porcelain'], repoRoot);
  if (result.code !== 0) {
    return repoRoot;
  }

  const match = result.stdout.match(/^worktree (.+)$/m);
  return match ? match[1].trim() : repoRoot;
}

describe('WU-1367: Claude Enforcement E2E', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-enforcement-'));

    // Create basic LumenFlow structure
    fs.mkdirSync(path.join(testDir, '.lumenflow'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Config Schema Integration', () => {
    it('should parse enforcement config from .lumenflow.config.yaml', async () => {
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
        require_wu_for_edits: false
        warn_on_stop_without_wu_done: true
`,
      );

      // Import and parse config
      const { parseConfig } = await import('@lumenflow/core/config-schema');
      const yaml = await import('yaml');

      const content = fs.readFileSync(configPath, 'utf-8');
      const rawConfig = yaml.parse(content);
      const config = parseConfig(rawConfig);

      expect(config.agents.clients[CLAUDE_CODE_CLIENT]).toBeDefined();
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement).toBeDefined();
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.hooks).toBe(true);
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.block_outside_worktree).toBe(
        true,
      );
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.require_wu_for_edits).toBe(
        false,
      );
      expect(
        config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.warn_on_stop_without_wu_done,
      ).toBe(true);
    });
  });

  describe('Hook Generation', () => {
    it('should generate hooks via integrateClaudeCode function', async () => {
      const { integrateClaudeCode } = await import('../src/commands/integrate.js');

      await integrateClaudeCode(testDir, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: true,
        },
      });

      // Check that hooks directory was created
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks'))).toBe(true);

      // Check that hook scripts were created
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'require-wu.sh'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'warn-incomplete.sh'))).toBe(
        true,
      );

      // Check that settings.json was updated
      const settingsPath = path.join(testDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it('should generate executable hook scripts', async () => {
      const { integrateClaudeCode } = await import('../src/commands/integrate.js');

      await integrateClaudeCode(testDir, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
        },
      });

      const hookPath = path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh');

      // Check file is executable
      const stat = fs.statSync(hookPath);
      const isExecutable = (stat.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);

      // Check script starts with shebang
      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });
  });

  describe('Hook Sync Integration', () => {
    it('should sync hooks when called via syncEnforcementHooks', async () => {
      // Create config file
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
`,
      );

      const { syncEnforcementHooks } = await import('../src/hooks/enforcement-sync.js');

      const result = await syncEnforcementHooks(testDir);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        true,
      );
    });

    it('should skip sync when hooks disabled in config', async () => {
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: false
`,
      );

      const { syncEnforcementHooks } = await import('../src/hooks/enforcement-sync.js');

      const result = await syncEnforcementHooks(testDir);

      expect(result).toBe(false);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        false,
      );
    });
  });

  describe('Graceful Degradation', () => {
    it('should allow operations when .lumenflow directory does not exist', async () => {
      // Remove .lumenflow directory
      fs.rmSync(path.join(testDir, '.lumenflow'), { recursive: true, force: true });

      const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

      // Set CLAUDE_PROJECT_DIR to test directory
      const originalEnv = process.env.CLAUDE_PROJECT_DIR;
      process.env.CLAUDE_PROJECT_DIR = testDir;

      try {
        const result = await checkWorktreeEnforcement({
          file_path: path.join(testDir, 'test.ts'),
          tool_name: 'Write',
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('graceful');
      } finally {
        process.env.CLAUDE_PROJECT_DIR = originalEnv;
      }
    });
  });
});

describe('WU-1466: Lifecycle Subprocess E2E', () => {
  it('runs wu:create -> wu:claim -> wu:prep -> wu:done and produces done stamp', () => {
    const repoRoot = path.resolve(process.cwd(), '../../..');
    const sharedCheckoutRoot = resolveSharedCheckoutRoot(repoRoot);
    const cliDist = path.join(sharedCheckoutRoot, 'packages/@lumenflow/cli/dist');
    expect(fs.existsSync(path.join(cliDist, 'wu-create.js'))).toBe(true);

    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-lifecycle-e2e-'));
    const remote = `${sandbox}-remote.git`;
    const wuNumericId = Math.floor(Date.now() / 1000);
    const wuId = `WU-${wuNumericId}`;
    const fixWuId = `WU-${wuNumericId + 1}`;

    try {
      assertCommandSuccess(
        'clone repo fixture',
        'git',
        ['clone', '-q', repoRoot, sandbox],
        repoRoot,
        runCommand('git', ['clone', '-q', repoRoot, sandbox], repoRoot),
      );

      assertCommandSuccess(
        'checkout main',
        'git',
        ['checkout', '-q', 'main'],
        sandbox,
        runCommand('git', ['checkout', '-q', 'main'], sandbox),
      );
      assertCommandSuccess(
        'configure git email',
        'git',
        ['config', 'user.email', 'test@example.com'],
        sandbox,
        runCommand('git', ['config', 'user.email', 'test@example.com'], sandbox),
      );
      assertCommandSuccess(
        'configure git name',
        'git',
        ['config', 'user.name', 'Test'],
        sandbox,
        runCommand('git', ['config', 'user.name', 'Test'], sandbox),
      );

      assertCommandSuccess(
        'init bare remote',
        'git',
        ['init', '-q', '--bare', remote],
        sandbox,
        runCommand('git', ['init', '-q', '--bare', remote], sandbox),
      );
      assertCommandSuccess(
        'set origin to writable bare remote',
        'git',
        ['remote', 'set-url', 'origin', remote],
        sandbox,
        runCommand('git', ['remote', 'set-url', 'origin', remote], sandbox),
      );
      assertCommandSuccess(
        'push baseline main',
        'git',
        ['push', '-q', '-u', 'origin', 'main'],
        sandbox,
        runCommand('git', ['push', '-q', '-u', 'origin', 'main'], sandbox),
      );

      // Isolate task state from repo WUs so this test is deterministic.
      fs.rmSync(path.join(sandbox, 'docs/04-operations/tasks'), { recursive: true, force: true });
      fs.mkdirSync(path.join(sandbox, 'docs/04-operations/tasks/wu'), { recursive: true });
      fs.mkdirSync(path.join(sandbox, 'docs/04-operations/tasks/initiatives'), { recursive: true });
      fs.mkdirSync(path.join(sandbox, '.lumenflow/state'), { recursive: true });
      fs.mkdirSync(path.join(sandbox, '.lumenflow/stamps'), { recursive: true });

      fs.writeFileSync(
        path.join(sandbox, 'docs/04-operations/tasks/backlog.md'),
        `---
sections:
  ready:
    heading: "## Ready"
  in_progress:
    heading: "## In Progress"
  blocked:
    heading: "## Blocked"
  done:
    heading: "## Done"
---

## Ready

## In Progress

## Blocked

## Done
`,
      );
      fs.writeFileSync(
        path.join(sandbox, 'docs/04-operations/tasks/status.md'),
        `# Status

## In Progress

## Ready

## Blocked

## Done
`,
      );
      fs.writeFileSync(path.join(sandbox, '.lumenflow/state/wu-events.jsonl'), '');

      assertCommandSuccess(
        'commit isolated task fixture',
        'git',
        ['add', 'docs/04-operations/tasks', '.lumenflow/state/wu-events.jsonl'],
        sandbox,
        runCommand(
          'git',
          ['add', 'docs/04-operations/tasks', '.lumenflow/state/wu-events.jsonl'],
          sandbox,
        ),
      );
      assertCommandSuccess(
        'commit isolated task fixture',
        'git',
        ['commit', '-q', '-m', 'test fixture state isolation'],
        sandbox,
        runCommand('git', ['commit', '-q', '-m', 'test fixture state isolation'], sandbox),
      );
      assertCommandSuccess(
        'push fixture commit',
        'git',
        ['push', '-q', 'origin', 'main'],
        sandbox,
        runCommand('git', ['push', '-q', 'origin', 'main'], sandbox),
      );

      const createArgs = [
        path.join(cliDist, 'wu-create.js'),
        '--id',
        wuId,
        '--lane',
        DOCS_LANE,
        '--title',
        'Lifecycle E2E',
        '--type',
        'documentation',
        '--description',
        'Context: lifecycle e2e. Problem: need real subprocess path. Solution: run full command chain.',
        '--acceptance',
        'Commands run end-to-end',
        '--code-paths',
        'docs/04-operations/tasks/backlog.md',
        '--test-paths-manual',
        'Run lifecycle e2e',
        '--spec-refs',
        'docs/plan.md',
        '--exposure',
        'documentation',
      ];
      const create = runCommand('node', createArgs, sandbox);
      assertCommandSuccess('wu:create', 'node', createArgs, sandbox, create);

      const createdWuPath = path.join(sandbox, `docs/04-operations/tasks/wu/${wuId}.yaml`);
      const createdWU = parseYAML(fs.readFileSync(createdWuPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(createdWU.status).toBe('ready');

      const claimArgs = [
        path.join(cliDist, 'wu-claim.js'),
        '--id',
        wuId,
        '--lane',
        DOCS_LANE,
        '--no-push',
      ];
      const claim = runCommand('node', claimArgs, sandbox);
      assertCommandSuccess('wu:claim', 'node', claimArgs, sandbox, claim);

      const claimOutput = `${claim.stdout}\n${claim.stderr}`;
      const extractedWorktree =
        extractWorktreePath(claimOutput) ??
        path.join(sandbox, 'worktrees', `content-documentation-${wuId.toLowerCase()}`);
      expect(fs.existsSync(extractedWorktree)).toBe(true);

      const worktreeWuPath = path.join(
        extractedWorktree,
        `docs/04-operations/tasks/wu/${wuId}.yaml`,
      );
      const claimedWU = parseYAML(fs.readFileSync(worktreeWuPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(claimedWU.status).toBe('in_progress');

      // wu:prep invokes package scripts from the worktree; point validation scripts at known dist.
      const worktreePkgPath = path.join(extractedWorktree, 'package.json');
      const originalWorktreePkg = fs.readFileSync(worktreePkgPath, 'utf-8');
      const pkg = JSON.parse(originalWorktreePkg) as {
        scripts: Record<string, string>;
      };
      pkg.scripts['wu:validate'] = `node ${path.join(cliDist, 'wu-validate.js')}`;
      pkg.scripts['spec:linter'] = `node ${path.join(cliDist, 'wu-validate.js')} --all`;
      fs.writeFileSync(worktreePkgPath, JSON.stringify(pkg, null, 2));

      const prettierArgs = ['exec', 'prettier', '--write', 'package.json'];
      const prettier = runCommand('pnpm', prettierArgs, extractedWorktree);
      assertCommandSuccess(
        'format temporary package script patch',
        'pnpm',
        prettierArgs,
        extractedWorktree,
        prettier,
      );

      const prepArgs = [path.join(cliDist, 'wu-prep.js'), '--id', wuId, '--docs-only'];
      const prep = runCommand('node', prepArgs, extractedWorktree);
      assertCommandSuccess('wu:prep', 'node', prepArgs, extractedWorktree, prep);

      // Keep worktree clean before wu:done by restoring temporary test-only script patch.
      fs.writeFileSync(worktreePkgPath, originalWorktreePkg);
      const restorePkg = runCommand('git', ['restore', 'package.json'], extractedWorktree);
      assertCommandSuccess(
        'restore temporary package patch',
        'git',
        ['restore', 'package.json'],
        extractedWorktree,
        restorePkg,
      );

      const doneArgs = [
        path.join(cliDist, 'wu-done.js'),
        '--id',
        wuId,
        '--no-merge',
        '--no-remove',
        '--docs-only',
        '--skip-gates',
        '--reason',
        'sandbox e2e uses temporary prep script patch',
        '--fix-wu',
        fixWuId,
      ];
      const done = runCommand('node', doneArgs, sandbox, { HUSKY: '0' });
      assertCommandSuccess('wu:done', 'node', doneArgs, sandbox, done);

      const completedWU = parseYAML(fs.readFileSync(worktreeWuPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(completedWU.status).toBe('done');
      expect(typeof completedWU.completed_at).toBe('string');

      const stampPath = path.join(extractedWorktree, `.lumenflow/stamps/${wuId}.done`);
      expect(fs.existsSync(stampPath)).toBe(true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
      fs.rmSync(remote, { recursive: true, force: true });
    }
  }, 240000);
});
