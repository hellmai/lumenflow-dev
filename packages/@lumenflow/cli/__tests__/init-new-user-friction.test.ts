/**
 * @file init-new-user-friction.test.ts
 * Tests for WU-2230: Fix new-user friction in lumenflow init
 *
 * Covers 4 issues discovered during new-user experience testing:
 * 1. Init must auto-install deps after scaffolding
 * 2. 'lumenflow init' wrapper must strip 'init' token in fallback path
 * 3. Pack-install failure should warn, not throw
 * 4. Scaffolded templates must be Prettier-formatted
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test file with repeated patterns */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('WU-2230: new-user friction fixes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-friction-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Fix 1: scaffoldProject adds devDependencies always (not just full mode)', () => {
    it('should add @lumenflow/cli to devDependencies even in minimal mode', async () => {
      // A fresh Next.js project has package.json but no lumenflow deps
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '0.1.0', private: true }, null, 2),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: false, // minimal mode — devDeps must still be injected
        framework: undefined,
        defaultClient: 'none',
        docsStructure: 'simple',
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.devDependencies['@lumenflow/cli']).toBeDefined();
      expect(pkg.devDependencies['@lumenflow/cli']).toMatch(/^\^3\./);
    });

    it('should add prettier to devDependencies even in minimal mode', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '0.1.0', private: true }, null, 2),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: false, // minimal mode
        framework: undefined,
        defaultClient: 'none',
        docsStructure: 'simple',
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.devDependencies['prettier']).toBeDefined();
    });

    it('should inject lumenflow scripts into package.json even in minimal mode', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'test-project',
            version: '0.1.0',
            scripts: { dev: 'next dev' },
          },
          null,
          2,
        ),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: false,
        framework: undefined,
        defaultClient: 'none',
        docsStructure: 'simple',
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      // Must have lumenflow scripts
      expect(pkg.scripts['wu:create']).toBeDefined();
      expect(pkg.scripts['gates']).toBeDefined();
      // Must preserve existing scripts
      expect(pkg.scripts['dev']).toBe('next dev');
    });
  });

  describe('Fix 1: auto-install after scaffolding', () => {
    it('should export runPostScaffoldInstall function', async () => {
      const initModule = await import('../src/init.js');
      expect(typeof initModule.runPostScaffoldInstall).toBe('function');
    });

    it('should detect pnpm from packageManager field and run pnpm install', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          { name: 'test', version: '0.1.0', packageManager: 'pnpm@10.28.1' },
          null,
          2,
        ),
      );

      const { runPostScaffoldInstall } = await import('../src/init.js');
      const result = await runPostScaffoldInstall(tempDir, { dryRun: true });

      expect(result.packageManager).toBe('pnpm');
      expect(result.command).toBe('pnpm install');
      expect(result.skipped).toBe(false);
    });

    it('should detect npm when no packageManager field exists', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }, null, 2),
      );
      // Create package-lock.json to indicate npm
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}');

      const { runPostScaffoldInstall } = await import('../src/init.js');
      const result = await runPostScaffoldInstall(tempDir, { dryRun: true });

      expect(result.packageManager).toBe('npm');
      expect(result.command).toBe('npm install');
    });

    it('should detect yarn from yarn.lock', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }, null, 2),
      );
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');

      const { runPostScaffoldInstall } = await import('../src/init.js');
      const result = await runPostScaffoldInstall(tempDir, { dryRun: true });

      expect(result.packageManager).toBe('yarn');
      expect(result.command).toBe('yarn install');
    });

    it('should skip install when no package.json exists', async () => {
      const { runPostScaffoldInstall } = await import('../src/init.js');
      const result = await runPostScaffoldInstall(tempDir, { dryRun: true });

      expect(result.skipped).toBe(true);
    });
  });

  describe('Fix 2: lumenflow wrapper strips init token in fallback path', () => {
    it('should route init command to init entry with remaining args only', async () => {
      const wrapperPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'lumenflow',
        'bin',
        'lumenflow.mjs',
      );
      const { resolveDispatchTarget } = await import(wrapperPath);

      const result = resolveDispatchTarget(['init', '--client', 'claude', '--preset', 'node'], []);
      expect(result.entryRelativePath).toBe('init.js');
      expect(result.forwardedArgs).toEqual(['--client', 'claude', '--preset', 'node']);
      expect(result.forwardedArgs).not.toContain('init');
    });

    it('should handle bare init with no additional args', async () => {
      const wrapperPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'lumenflow',
        'bin',
        'lumenflow.mjs',
      );
      const { resolveDispatchTarget } = await import(wrapperPath);

      const result = resolveDispatchTarget(['init'], []);
      expect(result.entryRelativePath).toBe('init.js');
      expect(result.forwardedArgs).toEqual([]);
    });

    it('should use forwardedArgs (not initialArgs) in fallback path', async () => {
      /**
       * Bug: When entry file doesn't exist, the wrapper falls back and uses
       * `initialArgs = process.argv.slice(2)` which includes the 'init' token.
       * This causes Commander to reject the extra positional argument.
       *
       * The fix: fallback path must use dispatchTarget.forwardedArgs, not initialArgs.
       */
      const wrapperPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'lumenflow',
        'bin',
        'lumenflow.mjs',
      );
      const wrapperSrc = fs.readFileSync(wrapperPath, 'utf-8');

      // The fallback path (when !existsSync(entryPath)) must NOT use initialArgs
      // for the init command. It should use dispatchTarget.forwardedArgs instead.
      // Check that the fallback uses forwardedArgs, not the raw initialArgs:
      const fallbackSection = wrapperSrc.slice(wrapperSrc.indexOf('if (!existsSync(entryPath))'));
      expect(fallbackSection).toContain('dispatchTarget.forwardedArgs');
    });
  });

  describe('Fix 3: pack-install failure is non-blocking', () => {
    it('should not throw when pack install fails and registry is unreachable', async () => {
      const { runInitBootstrap } = await import('../src/init.js');

      // Create a workspace.yaml so bootstrap doesn't skip for "already exists"
      // but use force to proceed anyway
      const result = await runInitBootstrap({
        targetDir: tempDir,
        force: true,
        bootstrapDomain: 'software-delivery',
        skipBootstrap: false,
        skipBootstrapPackInstall: false,
        // Use a fetch that always fails to simulate unreachable registry
        fetchFn: async () => {
          throw new Error('Network unreachable');
        },
      });

      // Should succeed with packInstalled: false and a warning, NOT throw
      expect(result.skipped).toBe(false);
      expect(result.packInstalled).toBe(false);
      expect(result.warning).toBeDefined();
    });
  });

  describe('Fix 4: scaffolded templates are Prettier-formatted', () => {
    it('should produce Prettier-clean LUMENFLOW.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: true,
        framework: undefined,
        defaultClient: 'claude',
        docsStructure: 'simple',
      });

      const lumenflowMd = fs.readFileSync(path.join(tempDir, 'LUMENFLOW.md'), 'utf-8');
      // Prettier markdown: no trailing whitespace, single trailing newline
      const lines = lumenflowMd.split('\n');
      for (const line of lines) {
        expect(line).toBe(line.trimEnd()); // no trailing whitespace
      }
      expect(lumenflowMd.endsWith('\n')).toBe(true);
      expect(lumenflowMd.endsWith('\n\n')).toBe(false); // no double trailing newline
    });

    it('should produce Prettier-clean constraints.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: true,
        framework: undefined,
        defaultClient: 'claude',
        docsStructure: 'simple',
      });

      const constraints = fs.readFileSync(
        path.join(tempDir, '.lumenflow', 'constraints.md'),
        'utf-8',
      );
      const lines = constraints.split('\n');
      for (const line of lines) {
        expect(line).toBe(line.trimEnd());
      }
      expect(constraints.endsWith('\n')).toBe(true);
      expect(constraints.endsWith('\n\n')).toBe(false);
    });

    it('should produce Prettier-clean CLAUDE.md when client=claude', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: true,
        framework: undefined,
        defaultClient: 'claude',
        docsStructure: 'simple',
      });

      const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
      if (fs.existsSync(claudeMdPath)) {
        const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
        const lines = claudeMd.split('\n');
        for (const line of lines) {
          expect(line).toBe(line.trimEnd());
        }
        expect(claudeMd.endsWith('\n')).toBe(true);
        expect(claudeMd.endsWith('\n\n')).toBe(false);
      }
    });

    it('should produce Prettier-clean backlog.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        force: false,
        full: true,
        framework: undefined,
        defaultClient: 'none',
        docsStructure: 'simple',
      });

      const backlogPath = path.join(tempDir, 'docs', 'tasks', 'backlog.md');
      if (fs.existsSync(backlogPath)) {
        const backlog = fs.readFileSync(backlogPath, 'utf-8');
        const lines = backlog.split('\n');
        for (const line of lines) {
          expect(line).toBe(line.trimEnd());
        }
        expect(backlog.endsWith('\n')).toBe(true);
      }
    });
  });
});
