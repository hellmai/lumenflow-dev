/**
 * Tests for arg-parser module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests command-line argument parsing using commander.js.
 * @see {@link ../arg-parser.ts}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WU_OPTIONS, WU_CREATE_OPTIONS, createWUParser, parseWUArgs } from '../arg-parser.js';

describe('arg-parser', () => {
  describe('WU_OPTIONS', () => {
    describe('string options', () => {
      it('should define id option with short and long flags', () => {
        expect(WU_OPTIONS.id.name).toBe('id');
        expect(WU_OPTIONS.id.flags).toBe('-i, --id <wuId>');
        expect(WU_OPTIONS.id.description).toContain('Work Unit ID');
      });

      it('should define lane option', () => {
        expect(WU_OPTIONS.lane.name).toBe('lane');
        expect(WU_OPTIONS.lane.flags).toBe('-l, --lane <lane>');
      });

      it('should define title option', () => {
        expect(WU_OPTIONS.title.name).toBe('title');
        expect(WU_OPTIONS.title.flags).toBe('-t, --title <title>');
      });

      it('should define priority option', () => {
        expect(WU_OPTIONS.priority.name).toBe('priority');
        expect(WU_OPTIONS.priority.flags).toBe('-p, --priority <priority>');
      });

      it('should define type option', () => {
        expect(WU_OPTIONS.type.name).toBe('type');
        expect(WU_OPTIONS.type.flags).toBe('--type <type>');
      });

      it('should define reason option', () => {
        expect(WU_OPTIONS.reason.name).toBe('reason');
        expect(WU_OPTIONS.reason.flags).toBe('-r, --reason <reason>');
      });

      it('should define worktree option', () => {
        expect(WU_OPTIONS.worktree.name).toBe('worktree');
        expect(WU_OPTIONS.worktree.flags).toBe('-w, --worktree <path>');
      });

      it('should define branch option', () => {
        expect(WU_OPTIONS.branch.name).toBe('branch');
        expect(WU_OPTIONS.branch.flags).toBe('-b, --branch <branch>');
      });

      it('should define fixWu option', () => {
        expect(WU_OPTIONS.fixWu.name).toBe('fixWu');
        expect(WU_OPTIONS.fixWu.flags).toBe('--fix-wu <wuId>');
      });

      it('should define client option', () => {
        expect(WU_OPTIONS.client.name).toBe('client');
        expect(WU_OPTIONS.client.flags).toBe('--client <client>');
      });
    });

    describe('boolean options', () => {
      it('should define force option', () => {
        expect(WU_OPTIONS.force.name).toBe('force');
        expect(WU_OPTIONS.force.flags).toBe('-f, --force');
      });

      it('should define branchOnly option', () => {
        expect(WU_OPTIONS.branchOnly.name).toBe('branchOnly');
        expect(WU_OPTIONS.branchOnly.flags).toBe('--branch-only');
      });

      it('should define prMode option', () => {
        expect(WU_OPTIONS.prMode.name).toBe('prMode');
        expect(WU_OPTIONS.prMode.flags).toBe('--pr-mode');
      });

      it('should define skipGates option', () => {
        expect(WU_OPTIONS.skipGates.name).toBe('skipGates');
        expect(WU_OPTIONS.skipGates.flags).toBe('--skip-gates');
      });

      it('should define docsOnly option', () => {
        expect(WU_OPTIONS.docsOnly.name).toBe('docsOnly');
        expect(WU_OPTIONS.docsOnly.flags).toBe('--docs-only');
      });

      it('should define validate option', () => {
        expect(WU_OPTIONS.validate.name).toBe('validate');
        expect(WU_OPTIONS.validate.flags).toBe('--validate');
      });
    });

    describe('negated options', () => {
      it('should mark noAuto as negated', () => {
        expect(WU_OPTIONS.noAuto.name).toBe('noAuto');
        expect(WU_OPTIONS.noAuto.flags).toBe('--no-auto');
        expect(WU_OPTIONS.noAuto.isNegated).toBe(true);
      });

      it('should mark noRemove as negated', () => {
        expect(WU_OPTIONS.noRemove.name).toBe('noRemove');
        expect(WU_OPTIONS.noRemove.flags).toBe('--no-remove');
        expect(WU_OPTIONS.noRemove.isNegated).toBe(true);
      });

      it('should mark noMerge as negated', () => {
        expect(WU_OPTIONS.noMerge.name).toBe('noMerge');
        expect(WU_OPTIONS.noMerge.flags).toBe('--no-merge');
        expect(WU_OPTIONS.noMerge.isNegated).toBe(true);
      });

      it('should mark noPush as negated', () => {
        expect(WU_OPTIONS.noPush.name).toBe('noPush');
        expect(WU_OPTIONS.noPush.flags).toBe('--no-push');
        expect(WU_OPTIONS.noPush.isNegated).toBe(true);
      });

      it('should mark noAutoRebase as negated', () => {
        expect(WU_OPTIONS.noAutoRebase.name).toBe('noAutoRebase');
        expect(WU_OPTIONS.noAutoRebase.flags).toBe('--no-auto-rebase');
        expect(WU_OPTIONS.noAutoRebase.isNegated).toBe(true);
      });
    });

    describe('repeatable options', () => {
      it('should mark acceptance as repeatable', () => {
        expect(WU_OPTIONS.acceptance.name).toBe('acceptance');
        expect(WU_OPTIONS.acceptance.isRepeatable).toBe(true);
      });

      it('should mark reconcileInitiative as repeatable', () => {
        expect(WU_OPTIONS.reconcileInitiative.name).toBe('reconcileInitiative');
        expect(WU_OPTIONS.reconcileInitiative.isRepeatable).toBe(true);
      });
    });

    describe('initiative options', () => {
      it('should define initiative option', () => {
        expect(WU_OPTIONS.initiative.name).toBe('initiative');
        expect(WU_OPTIONS.initiative.flags).toBe('--initiative <ref>');
      });

      it('should define phase option', () => {
        expect(WU_OPTIONS.phase.name).toBe('phase');
        expect(WU_OPTIONS.phase.flags).toBe('--phase <number>');
      });

      it('should define blockedBy option', () => {
        expect(WU_OPTIONS.blockedBy.name).toBe('blockedBy');
        expect(WU_OPTIONS.blockedBy.flags).toBe('--blocked-by <wuIds>');
      });

      it('should define blocks option', () => {
        expect(WU_OPTIONS.blocks.name).toBe('blocks');
        expect(WU_OPTIONS.blocks.flags).toBe('--blocks <wuIds>');
      });
    });

    describe('spec creation options', () => {
      it('should define description option', () => {
        expect(WU_OPTIONS.description.name).toBe('description');
        expect(WU_OPTIONS.description.flags).toBe('--description <text>');
      });

      it('should define codePaths option', () => {
        expect(WU_OPTIONS.codePaths.name).toBe('codePaths');
        expect(WU_OPTIONS.codePaths.flags).toBe('--code-paths <paths>');
      });

      it('should define specRefs option', () => {
        expect(WU_OPTIONS.specRefs.name).toBe('specRefs');
        expect(WU_OPTIONS.specRefs.flags).toBe('--spec-refs <paths>');
      });

      it('should define exposure option', () => {
        expect(WU_OPTIONS.exposure.name).toBe('exposure');
        expect(WU_OPTIONS.exposure.flags).toBe('--exposure <type>');
      });
    });

    describe('thinking mode options', () => {
      it('should define thinking option', () => {
        expect(WU_OPTIONS.thinking.name).toBe('thinking');
        expect(WU_OPTIONS.thinking.flags).toBe('--thinking');
      });

      it('should define noThinking option', () => {
        expect(WU_OPTIONS.noThinking.name).toBe('noThinking');
        expect(WU_OPTIONS.noThinking.flags).toBe('--no-thinking');
        expect(WU_OPTIONS.noThinking.isNegated).toBe(true);
      });

      it('should define budget option', () => {
        expect(WU_OPTIONS.budget.name).toBe('budget');
        expect(WU_OPTIONS.budget.flags).toBe('--budget <tokens>');
      });
    });

    describe('spawn options', () => {
      it('should define parentWu option', () => {
        expect(WU_OPTIONS.parentWu.name).toBe('parentWu');
        expect(WU_OPTIONS.parentWu.flags).toBe('--parent-wu <wuId>');
      });

      it('should define codex option', () => {
        expect(WU_OPTIONS.codex.name).toBe('codex');
        expect(WU_OPTIONS.codex.flags).toBe('--codex');
      });
    });

    describe('safety options', () => {
      it('should define resume option', () => {
        expect(WU_OPTIONS.resume.name).toBe('resume');
        expect(WU_OPTIONS.resume.flags).toBe('--resume');
      });

      it('should define overrideOwner option', () => {
        expect(WU_OPTIONS.overrideOwner.name).toBe('overrideOwner');
        expect(WU_OPTIONS.overrideOwner.flags).toBe('--override-owner');
      });

      it('should define forceOverlap option', () => {
        expect(WU_OPTIONS.forceOverlap.name).toBe('forceOverlap');
        expect(WU_OPTIONS.forceOverlap.flags).toBe('--force-overlap');
      });
    });
  });

  describe('WU_CREATE_OPTIONS', () => {
    it('should define plan option', () => {
      expect(WU_CREATE_OPTIONS.plan.name).toBe('plan');
      expect(WU_CREATE_OPTIONS.plan.flags).toBe('--plan');
      expect(WU_CREATE_OPTIONS.plan.description).toContain('LUMENFLOW_HOME');
    });
  });

  describe('createWUParser', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;

    beforeEach(() => {
      originalArgv = process.argv;
      // Mock process.exit to prevent test from exiting
      originalExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exit = originalExit;
    });

    it('should parse simple flags', () => {
      process.argv = ['node', 'test.js', '--id', 'WU-123', '--lane', 'Framework: Core'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.id, WU_OPTIONS.lane],
      });

      expect(opts.id).toBe('WU-123');
      expect(opts.lane).toBe('Framework: Core');
    });

    it('should parse short flags', () => {
      process.argv = ['node', 'test.js', '-i', 'WU-456', '-l', 'Operations'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.id, WU_OPTIONS.lane],
      });

      expect(opts.id).toBe('WU-456');
      expect(opts.lane).toBe('Operations');
    });

    it('should parse boolean flags', () => {
      process.argv = ['node', 'test.js', '--force', '--skip-gates'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.force, WU_OPTIONS.skipGates],
      });

      expect(opts.force).toBe(true);
      expect(opts.skipGates).toBe(true);
    });

    it('should handle positional ID when allowPositionalId is true', () => {
      process.argv = ['node', 'test.js', 'WU-789'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.id],
        allowPositionalId: true,
      });

      expect(opts.id).toBe('WU-789');
    });

    it('should prefer flag over positional', () => {
      process.argv = ['node', 'test.js', '--id', 'WU-FLAG', 'WU-POSITIONAL'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.id],
        allowPositionalId: true,
      });

      expect(opts.id).toBe('WU-FLAG');
    });

    it('should filter pnpm -- separator', () => {
      process.argv = ['node', 'test.js', '--', '--id', 'WU-123'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.id],
      });

      expect(opts.id).toBe('WU-123');
    });

    it('should parse repeatable options', () => {
      process.argv = [
        'node',
        'test.js',
        '--acceptance',
        'Criterion 1',
        '--acceptance',
        'Criterion 2',
      ];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.acceptance],
      });

      expect(opts.acceptance).toEqual(['Criterion 1', 'Criterion 2']);
    });

    it('should return empty array for unused repeatable options', () => {
      process.argv = ['node', 'test.js'];

      const opts = createWUParser({
        name: 'test',
        description: 'Test parser',
        options: [WU_OPTIONS.acceptance],
      });

      expect(opts.acceptance).toEqual([]);
    });
  });

  describe('parseWUArgs (deprecated)', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;

    beforeEach(() => {
      originalArgv = process.argv;
      originalExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exit = originalExit;
    });

    it('should parse argv and return opts object', () => {
      const argv = ['node', 'test.js', '--id', 'WU-123', '--lane', 'Framework'];

      const opts = parseWUArgs(argv);

      expect(opts.id).toBe('WU-123');
      expect(opts.lane).toBe('Framework');
    });

    it('should handle positional argument as ID fallback', () => {
      const argv = ['node', 'test.js', 'WU-999'];

      const opts = parseWUArgs(argv);

      expect(opts.id).toBe('WU-999');
    });

    it('should filter pnpm -- separator', () => {
      const argv = ['node', 'test.js', '--', '--id', 'WU-555'];

      const opts = parseWUArgs(argv);

      expect(opts.id).toBe('WU-555');
    });

    it('should parse boolean options', () => {
      const argv = ['node', 'test.js', '--force', '--branch-only'];

      const opts = parseWUArgs(argv);

      expect(opts.force).toBe(true);
      expect(opts.branchOnly).toBe(true);
    });
  });
});
