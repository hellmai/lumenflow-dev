/**
 * @file enforcement-matrix.test.ts
 * End-to-end enforcement parity tests across hook/TS/MCP paths (WU-2137)
 *
 * Tests verify that the three enforcement paths produce consistent allow/block
 * decisions for the same inputs using real git/filesystem fixtures:
 *
 * 1. Shell hook (enforce-worktree.sh) -- subprocess with stdin JSON
 * 2. TS enforcement (enforcement-checks.ts) -- checkWorktreeEnforcement()
 * 3. MCP enforcement (worktree-enforcement.ts) -- checkWorktreeEnforcement()
 *
 * Parity contract: For identical filesystem/git state and input, all three
 * paths must agree on allow vs block (exit 0 vs exit 2, allowed: true/false).
 *
 * Documented divergences:
 * - TS enforcement does NOT check branch name (blocks based on claim context
 *   only). Shell hook and MCP both check branch name first (allow non-main).
 *   This means detached HEAD is allowed by hook/MCP but blocked by TS.
 * - Shell hook blocks ALL main writes when worktrees exist (no allowlist check).
 *   TS enforcement has the same behavior. The allowlist only applies when
 *   no worktrees exist and no branch-pr claim is active.
 */

// Test file lint exceptions
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable security/detect-object-injection */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';

// MCP worktree enforcement -- imported directly from source since
// @lumenflow/mcp does not export it as a package subpath.
import { checkWorktreeEnforcement as mcpCheckWorktreeEnforcement } from '../../mcp/src/worktree-enforcement.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOOK_ALLOW_EXIT = 0;
const HOOK_BLOCK_EXIT = 2;

/** Timeout for entire describe blocks that create git fixtures */
const FIXTURE_TIMEOUT_MS = 120_000;

/** Timeout for individual subprocess calls */
const SUBPROCESS_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the enforce-worktree.sh hook as a subprocess with JSON on stdin.
 */
function runShellHook(
  hookPath: string,
  stdinJson: Record<string, unknown>,
  env: Record<string, string>,
): HookResult {
  const result = spawnSync('bash', [hookPath], {
    input: JSON.stringify(stdinJson),
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Build the stdin JSON that Claude Code sends to PreToolUse hooks.
 */
function buildHookInput(toolName: string, filePath: string): Record<string, unknown> {
  return {
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

/**
 * Initialize a temporary git repo with LumenFlow structure on the main branch.
 * Returns the repo path.
 */
function createGitFixture(prefix: string): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `lumenflow-${prefix}-`));

  // Init repo
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  spawnSync('git', ['config', 'user.email', 'test@e2e.local'], { cwd: repoDir });
  spawnSync('git', ['config', 'user.name', 'E2E Test'], { cwd: repoDir });

  // Create LumenFlow structure
  fs.mkdirSync(path.join(repoDir, '.lumenflow', 'state'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.lumenflow', 'stamps'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'worktrees'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs', '04-operations', 'tasks', 'wu'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'plan'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

  // Minimal workspace.yaml for MCP config resolution
  fs.writeFileSync(
    path.join(repoDir, 'workspace.yaml'),
    [
      'software_delivery:',
      '  directories:',
      '    worktrees: worktrees',
      '    wuDir: docs/04-operations/tasks/wu',
      '  agents:',
      '    clients:',
      '      claude-code:',
      '        enforcement:',
      '          hooks: true',
      '          block_outside_worktree: true',
      '          require_wu_for_edits: true',
      '          warn_on_stop_without_wu_done: true',
    ].join('\n'),
  );

  // Empty events file
  fs.writeFileSync(path.join(repoDir, '.lumenflow', 'state', 'wu-events.jsonl'), '');

  // A source file to serve as a "code" write target
  fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), '// app\n');

  // Initial commit
  spawnSync('git', ['add', '.'], { cwd: repoDir });
  spawnSync('git', ['commit', '-q', '-m', 'initial fixture'], { cwd: repoDir });

  return repoDir;
}

/**
 * Create a worktree directory inside the fixture (simulates an active worktree).
 */
function addWorktreeDir(repoDir: string, name: string): string {
  const wtPath = path.join(repoDir, 'worktrees', name);
  fs.mkdirSync(wtPath, { recursive: true });
  return wtPath;
}

/**
 * Write a branch-pr claim event to the state file.
 */
function writeBranchPrClaim(repoDir: string): void {
  const stateFile = path.join(repoDir, '.lumenflow', 'state', 'wu-events.jsonl');
  const event = JSON.stringify({
    id: 'WU-9999',
    status: 'in_progress',
    claimed_mode: 'branch-pr',
    timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(stateFile, event + '\n');
}

/**
 * Resolve the absolute path to the hook template in this repo.
 */
function resolveHookTemplatePath(): string {
  const cliRoot = path.resolve(__dirname, '..');
  return path.join(
    cliRoot,
    'templates',
    'vendors',
    'claude',
    '.claude',
    'hooks',
    'enforce-worktree.sh',
  );
}

// ---------------------------------------------------------------------------
// Test matrix inputs
// ---------------------------------------------------------------------------

interface MatrixInput {
  label: string;
  toolName: string;
  /** Relative to repo root */
  relPath: string;
  /** Expected: true = allowed, false = blocked */
  expectAllowed: boolean;
}

/**
 * Matrix inputs for testing on main branch with NO active worktrees and
 * NO branch-pr claim (fail-closed).
 *
 * In this state:
 * - Allowlisted paths are permitted (WU specs, .lumenflow/, .claude/, plan/)
 * - Non-allowlisted Write/Edit to code paths is blocked
 * - Non-Write/Edit tools (Read, Bash, Glob) are always allowed by the hook
 */
const FAIL_CLOSED_MATRIX: MatrixInput[] = [
  // Allowlisted paths -- should be allowed
  {
    label: 'allowlist: .lumenflow/ config write',
    toolName: 'Write',
    relPath: '.lumenflow/config.yaml',
    expectAllowed: true,
  },
  {
    label: 'allowlist: .claude/ settings write',
    toolName: 'Write',
    relPath: '.claude/settings.json',
    expectAllowed: true,
  },
  {
    label: 'allowlist: WU YAML spec write',
    toolName: 'Write',
    relPath: 'docs/04-operations/tasks/wu/WU-100.yaml',
    expectAllowed: true,
  },
  {
    label: 'allowlist: plan/ directory write',
    toolName: 'Write',
    relPath: 'plan/design.md',
    expectAllowed: true,
  },
  // Non-allowlisted paths -- should be blocked (fail-closed)
  {
    label: 'blocked: src/app.ts code write',
    toolName: 'Write',
    relPath: 'src/app.ts',
    expectAllowed: false,
  },
  {
    label: 'blocked: src/app.ts code edit',
    toolName: 'Edit',
    relPath: 'src/app.ts',
    expectAllowed: false,
  },
  {
    label: 'blocked: README.md root file write',
    toolName: 'Write',
    relPath: 'README.md',
    expectAllowed: false,
  },
  {
    label: 'blocked: package.json root file edit',
    toolName: 'Edit',
    relPath: 'package.json',
    expectAllowed: false,
  },
  // Non-Write/Edit tools -- should always be allowed (hook only blocks Write/Edit)
  {
    label: 'allowed: Read tool on code path',
    toolName: 'Read',
    relPath: 'src/app.ts',
    expectAllowed: true,
  },
  {
    label: 'allowed: Bash tool on code path',
    toolName: 'Bash',
    relPath: 'src/app.ts',
    expectAllowed: true,
  },
  {
    label: 'allowed: Glob tool',
    toolName: 'Glob',
    relPath: '.',
    expectAllowed: true,
  },
];

/**
 * Matrix inputs for testing on main with ACTIVE worktrees.
 *
 * IMPORTANT: When worktrees exist, the enforcement paths block ALL writes
 * to main repo paths -- including paths that would be allowlisted in the
 * fail-closed scenario. The allowlist only applies when no worktrees exist.
 * This is by design: when worktrees are active, all work should happen there.
 */
const WORKTREE_ACTIVE_MATRIX: MatrixInput[] = [
  {
    label: 'worktree: write inside worktree path is allowed',
    toolName: 'Write',
    relPath: 'worktrees/lane-wu-42/src/app.ts',
    expectAllowed: true,
  },
  {
    label: 'worktree: edit inside worktree path is allowed',
    toolName: 'Edit',
    relPath: 'worktrees/lane-wu-42/src/app.ts',
    expectAllowed: true,
  },
  {
    label: 'worktree: write to main src is blocked',
    toolName: 'Write',
    relPath: 'src/app.ts',
    expectAllowed: false,
  },
  {
    label: 'worktree: .lumenflow/ write blocked when worktrees active',
    toolName: 'Write',
    relPath: '.lumenflow/stamps/WU-42.done',
    expectAllowed: false,
  },
];

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('WU-2137: Enforcement Matrix E2E', () => {
  let hookPath: string;

  beforeAll(() => {
    hookPath = resolveHookTemplatePath();
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Suite 1: Hook stdin parity -- shell hook with real git repo
  // -----------------------------------------------------------------------
  describe(
    'Shell hook stdin parity (fail-closed on main, no worktrees)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('hook-failclosed');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      for (const input of FAIL_CLOSED_MATRIX) {
        it(`hook: ${input.label}`, () => {
          const absPath = path.join(repoDir, input.relPath);
          const stdinJson = buildHookInput(input.toolName, absPath);
          const env = { CLAUDE_PROJECT_DIR: repoDir };
          const result = runShellHook(hookPath, stdinJson, env);

          if (input.expectAllowed) {
            expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
          } else {
            expect(result.exitCode).toBe(HOOK_BLOCK_EXIT);
          }
        });
      }
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 2: Hook stdin parity -- active worktree scenario
  // -----------------------------------------------------------------------
  describe(
    'Shell hook stdin parity (active worktrees)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('hook-worktree');
        addWorktreeDir(repoDir, 'lane-wu-42');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      for (const input of WORKTREE_ACTIVE_MATRIX) {
        it(`hook: ${input.label}`, () => {
          const absPath = path.join(repoDir, input.relPath);
          const stdinJson = buildHookInput(input.toolName, absPath);
          const env = { CLAUDE_PROJECT_DIR: repoDir };
          const result = runShellHook(hookPath, stdinJson, env);

          if (input.expectAllowed) {
            expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
          } else {
            expect(result.exitCode).toBe(HOOK_BLOCK_EXIT);
          }
        });
      }
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 3: TS enforcement parity -- same matrix, same git fixtures
  // -----------------------------------------------------------------------
  describe(
    'TS enforcement parity (fail-closed on main, no worktrees)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('ts-failclosed');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      for (const input of FAIL_CLOSED_MATRIX) {
        // TS enforcement only applies to Write/Edit; other tools are not checked
        if (input.toolName !== 'Write' && input.toolName !== 'Edit') {
          continue;
        }

        it(`ts: ${input.label}`, async () => {
          const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

          const absPath = path.join(repoDir, input.relPath);
          const result = await checkWorktreeEnforcement(
            { file_path: absPath, tool_name: input.toolName },
            repoDir,
          );

          expect(result.allowed).toBe(input.expectAllowed);
        });
      }
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 4: TS enforcement parity -- active worktree scenario
  // -----------------------------------------------------------------------
  describe(
    'TS enforcement parity (active worktrees)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('ts-worktree');
        addWorktreeDir(repoDir, 'lane-wu-42');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      for (const input of WORKTREE_ACTIVE_MATRIX) {
        if (input.toolName !== 'Write' && input.toolName !== 'Edit') {
          continue;
        }

        it(`ts: ${input.label}`, async () => {
          const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

          const absPath = path.join(repoDir, input.relPath);
          const result = await checkWorktreeEnforcement(
            { file_path: absPath, tool_name: input.toolName },
            repoDir,
          );

          expect(result.allowed).toBe(input.expectAllowed);
        });
      }
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 5: MCP enforcement parity (uses real git for branch detection)
  // -----------------------------------------------------------------------
  describe(
    'MCP enforcement parity (fail-closed on main, no worktrees)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('mcp-failclosed');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      for (const input of FAIL_CLOSED_MATRIX) {
        if (input.toolName !== 'Write' && input.toolName !== 'Edit') {
          continue;
        }

        it(`mcp: ${input.label}`, () => {
          const absPath = path.join(repoDir, input.relPath);
          const result = mcpCheckWorktreeEnforcement({
            filePath: absPath,
            projectRoot: repoDir,
          });

          expect(result.allowed).toBe(input.expectAllowed);
        });
      }
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 6: Branch-PR mode claim path
  // -----------------------------------------------------------------------
  describe(
    'Branch-PR mode permits main writes',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('branchpr');
        writeBranchPrClaim(repoDir);
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: branch-pr claim allows code write on main', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: branch-pr claim allows code write on main', async () => {
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

        const absPath = path.join(repoDir, 'src/app.ts');
        const result = await checkWorktreeEnforcement(
          { file_path: absPath, tool_name: 'Write' },
          repoDir,
        );

        expect(result.allowed).toBe(true);
      });

      it('hook: branch-pr claim allows edit on main', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Edit', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: branch-pr claim allows edit on main', async () => {
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

        const absPath = path.join(repoDir, 'src/app.ts');
        const result = await checkWorktreeEnforcement(
          { file_path: absPath, tool_name: 'Edit' },
          repoDir,
        );

        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 7: Detached HEAD edge case
  // -----------------------------------------------------------------------
  describe(
    'Detached HEAD edge conditions',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('detached');
        // Detach HEAD at the current commit
        const headSha = spawnSync('git', ['rev-parse', 'HEAD'], {
          cwd: repoDir,
          encoding: 'utf-8',
        }).stdout.trim();
        spawnSync('git', ['checkout', '--detach', headSha], { cwd: repoDir });
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: detached HEAD allows code write (HEAD is not main/master)', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        // Detached HEAD returns "HEAD" from rev-parse --abbrev-ref HEAD
        // which is not main/master, so the hook allows it
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: detached HEAD is fail-closed (TS does not check branch name)', async () => {
        // DOCUMENTED DIVERGENCE: TS enforcement does NOT check branch name.
        // It checks: worktree existence, allowlist, branch-pr claim.
        // With no worktrees and no claim on a configured LumenFlow repo,
        // it returns fail-closed regardless of current branch.
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

        const absPath = path.join(repoDir, 'src/app.ts');
        const result = await checkWorktreeEnforcement(
          { file_path: absPath, tool_name: 'Write' },
          repoDir,
        );

        // TS enforcement is fail-closed regardless of branch
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('no active claim context');
      });

      it('mcp: detached HEAD allows write (HEAD is not a protected branch)', () => {
        // MCP checks branch name like the shell hook. Detached HEAD returns "HEAD"
        // which is not in PROTECTED_BRANCHES (main/master), so it allows.
        const result = mcpCheckWorktreeEnforcement({
          filePath: path.join(repoDir, 'src/app.ts'),
          projectRoot: repoDir,
        });

        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 8: Graceful degradation -- no .lumenflow directory
  // -----------------------------------------------------------------------
  describe(
    'Graceful degradation (no LumenFlow configured)',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-nolf-'));
        spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
        spawnSync('git', ['config', 'user.email', 'test@e2e.local'], { cwd: repoDir });
        spawnSync('git', ['config', 'user.name', 'E2E Test'], { cwd: repoDir });
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), '// app\n');
        spawnSync('git', ['add', '.'], { cwd: repoDir });
        spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repoDir });
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: allows write when .lumenflow absent', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: allows write when .lumenflow absent', async () => {
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');
        const absPath = path.join(repoDir, 'src/app.ts');
        const result = await checkWorktreeEnforcement(
          { file_path: absPath, tool_name: 'Write' },
          repoDir,
        );
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('graceful');
      });

      it('mcp: allows write when .lumenflow absent', () => {
        const result = mcpCheckWorktreeEnforcement({
          filePath: path.join(repoDir, 'src/app.ts'),
          projectRoot: repoDir,
        });
        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 9: Path outside repository
  // -----------------------------------------------------------------------
  describe(
    'Path outside repository',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('outside');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: allows write to path outside repo', () => {
        const outsidePath = path.join(os.tmpdir(), 'totally-outside.ts');
        const stdinJson = buildHookInput('Write', outsidePath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: allows write to path outside repo', async () => {
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');
        const outsidePath = path.join(os.tmpdir(), 'totally-outside.ts');
        const result = await checkWorktreeEnforcement(
          { file_path: outsidePath, tool_name: 'Write' },
          repoDir,
        );
        expect(result.allowed).toBe(true);
      });

      it('mcp: allows write to path outside repo', () => {
        const outsidePath = path.join(os.tmpdir(), 'totally-outside.ts');
        const result = mcpCheckWorktreeEnforcement({
          filePath: outsidePath,
          projectRoot: repoDir,
        });
        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 10: Non-main branch allows all writes (hook + MCP)
  // -----------------------------------------------------------------------
  describe(
    'Non-main branch allows all writes',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('nonmain');
        // Create and switch to a feature branch
        spawnSync('git', ['checkout', '-b', 'feature/test'], { cwd: repoDir });
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: allows code write on feature branch', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('hook: allows code edit on feature branch', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Edit', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('mcp: allows code write on feature branch', () => {
        const result = mcpCheckWorktreeEnforcement({
          filePath: path.join(repoDir, 'src/app.ts'),
          projectRoot: repoDir,
        });
        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 11: Empty/malformed stdin handling for shell hook
  // -----------------------------------------------------------------------
  describe('Shell hook stdin edge cases', () => {
    let repoDir: string;

    beforeAll(() => {
      repoDir = createGitFixture('stdin-edge');
    });

    afterAll(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('hook: empty stdin allows operation (fail-open on bad input)', () => {
      const result = spawnSync('bash', [hookPath], {
        input: '',
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
      expect(result.status).toBe(HOOK_ALLOW_EXIT);
    });

    it('hook: malformed JSON allows operation (fail-open on parse error)', () => {
      const result = spawnSync('bash', [hookPath], {
        input: '{not valid json',
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
      expect(result.status).toBe(HOOK_ALLOW_EXIT);
    });

    it('hook: missing tool_name allows operation', () => {
      const result = spawnSync('bash', [hookPath], {
        input: JSON.stringify({ tool_input: { file_path: '/tmp/x.ts' } }),
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
      // tool_name is empty -> not Write/Edit -> allow
      expect(result.status).toBe(HOOK_ALLOW_EXIT);
    });

    it('hook: missing file_path with Write tool blocks on main', () => {
      const result = spawnSync('bash', [hookPath], {
        input: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
      // Empty file_path -> resolved path is empty -> fails the allowlist
      // and there are no worktrees and no branch-pr claim -> blocked
      expect(result.status).toBe(HOOK_BLOCK_EXIT);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 12: Special characters in paths
  // -----------------------------------------------------------------------
  describe(
    'Special characters in file paths',
    () => {
      let repoDir: string;

      beforeAll(() => {
        repoDir = createGitFixture('special-chars');
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: path with spaces in allowlisted directory is allowed', () => {
        const absPath = path.join(repoDir, '.lumenflow', 'my config.yaml');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_ALLOW_EXIT);
      });

      it('ts: path with spaces in allowlisted directory is allowed', async () => {
        const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');
        const absPath = path.join(repoDir, '.lumenflow', 'my config.yaml');
        const result = await checkWorktreeEnforcement(
          { file_path: absPath, tool_name: 'Write' },
          repoDir,
        );
        expect(result.allowed).toBe(true);
      });

      it('mcp: path with spaces in allowlisted directory is allowed', () => {
        const absPath = path.join(repoDir, '.lumenflow', 'my config.yaml');
        const result = mcpCheckWorktreeEnforcement({
          filePath: absPath,
          projectRoot: repoDir,
        });
        expect(result.allowed).toBe(true);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Suite 13: Master branch enforcement (parity with main)
  // -----------------------------------------------------------------------
  describe(
    'Master branch enforcement parity',
    () => {
      let repoDir: string;

      beforeAll(() => {
        // Create repo with "master" as default branch and full enforcement config
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-master-'));
        spawnSync('git', ['init', '-q', '-b', 'master'], { cwd: repoDir });
        spawnSync('git', ['config', 'user.email', 'test@e2e.local'], { cwd: repoDir });
        spawnSync('git', ['config', 'user.name', 'E2E Test'], { cwd: repoDir });
        fs.mkdirSync(path.join(repoDir, '.lumenflow', 'state'), { recursive: true });
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, '.lumenflow', 'state', 'wu-events.jsonl'), '');
        fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), '// app\n');
        // MCP requires workspace.yaml with enforcement config to block
        fs.writeFileSync(
          path.join(repoDir, 'workspace.yaml'),
          [
            'software_delivery:',
            '  directories:',
            '    worktrees: worktrees',
            '    wuDir: docs/04-operations/tasks/wu',
            '  agents:',
            '    clients:',
            '      claude-code:',
            '        enforcement:',
            '          hooks: true',
            '          block_outside_worktree: true',
          ].join('\n'),
        );
        spawnSync('git', ['add', '.'], { cwd: repoDir });
        spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repoDir });
      });

      afterAll(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
      });

      it('hook: blocks code write on master branch', () => {
        const absPath = path.join(repoDir, 'src/app.ts');
        const stdinJson = buildHookInput('Write', absPath);
        const env = { CLAUDE_PROJECT_DIR: repoDir };
        const result = runShellHook(hookPath, stdinJson, env);
        expect(result.exitCode).toBe(HOOK_BLOCK_EXIT);
      });

      it('mcp: blocks code write on master branch', () => {
        const result = mcpCheckWorktreeEnforcement({
          filePath: path.join(repoDir, 'src/app.ts'),
          projectRoot: repoDir,
        });
        expect(result.allowed).toBe(false);
      });
    },
    FIXTURE_TIMEOUT_MS,
  );
});
