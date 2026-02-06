/**
 * Tests for spec:linter worktree fallback (WU-1218)
 *
 * Verifies that spec:linter uses cli-entry.mjs to enable fallback to main
 * repo CLI dist when worktree dist is missing.
 *
 * Context: wu:done runs spec:linter in worktree which fails when CLI dist
 * is missing. WU-1038 fixed gates fallback but spec:linter still used
 * direct node invocation without fallback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCliDistEntry, selectCliEntryPath } from '../../../../tools/cli-entry.mjs';

/** The cli-entry.mjs script path expected in package.json scripts */
const CLI_ENTRY_SCRIPT = 'tools/cli-entry.mjs';

describe('spec:linter worktree fallback (WU-1218)', () => {
  /**
   * Verifies that the spec:linter script uses cli-entry.mjs for worktree fallback.
   *
   * Before WU-1218:
   *   "spec:linter": "node packages/@lumenflow/cli/dist/wu-validate.js --all"
   *   This fails in worktrees without CLI dist.
   *
   * After WU-1218:
   *   "spec:linter": "node tools/cli-entry.mjs wu-validate --all"
   *   This enables fallback to main repo CLI dist.
   */
  it('spec:linter script should use cli-entry.mjs for worktree fallback', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const specLinterScript = packageJson.scripts?.['spec:linter'];

    expect(specLinterScript).toBeDefined();

    // Should use cli-entry.mjs instead of direct node invocation
    expect(specLinterScript).toContain(CLI_ENTRY_SCRIPT);

    // Should NOT use direct path to dist (the old broken pattern)
    expect(specLinterScript).not.toContain('packages/@lumenflow/cli/dist/wu-validate.js');

    // Should pass wu-validate as the entry point with --all flag
    expect(specLinterScript).toContain('wu-validate');
    expect(specLinterScript).toContain('--all');
  });

  /**
   * Verifies that cli-entry.mjs supports the wu-validate entry point.
   *
   * The wu-validate entry needs to work with the fallback mechanism
   * just like gates does.
   */
  it('cli-entry.mjs should support wu-validate entry point', () => {
    const repoRoot = '/repo/worktrees/foo';
    const mainRepo = '/repo';
    const entry = 'wu-validate';

    // Verify wu-validate entry path is resolved correctly
    const entryPath = resolveCliDistEntry(repoRoot, entry);
    expect(entryPath).toContain('wu-validate.js');

    // Verify fallback works for wu-validate
    const fallbackPath = resolveCliDistEntry(mainRepo, entry);
    const selected = selectCliEntryPath({
      repoRoot,
      entry,
      mainRepoPath: mainRepo,
      exists: (candidate: string) => candidate === fallbackPath,
    });
    expect(selected).toBe(fallbackPath);
  });

  /**
   * Verifies consistency between gates and spec:linter invocation patterns.
   *
   * Both should use cli-entry.mjs for worktree fallback support.
   */
  it('gates and spec:linter should both use cli-entry.mjs', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const gatesScript = packageJson.scripts?.['gates'];
    const specLinterScript = packageJson.scripts?.['spec:linter'];

    // Both should use cli-entry.mjs
    expect(gatesScript).toContain(CLI_ENTRY_SCRIPT);
    expect(specLinterScript).toContain(CLI_ENTRY_SCRIPT);
  });

  it('wu:validate, wu:prep, and mem:checkpoint scripts should use cli-entry.mjs', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const wuValidateScript = packageJson.scripts?.['wu:validate'];
    const wuPrepScript = packageJson.scripts?.['wu:prep'];
    const memCheckpointScript = packageJson.scripts?.['mem:checkpoint'];

    expect(wuValidateScript).toBeDefined();
    expect(wuPrepScript).toBeDefined();
    expect(memCheckpointScript).toBeDefined();

    expect(wuValidateScript).toContain(CLI_ENTRY_SCRIPT);
    expect(wuPrepScript).toContain(CLI_ENTRY_SCRIPT);
    expect(memCheckpointScript).toContain(CLI_ENTRY_SCRIPT);
  });
});
