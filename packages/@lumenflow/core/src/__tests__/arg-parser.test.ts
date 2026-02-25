// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import { ProcessExitError } from '../error-handler.js';

// Test fixture constants (WU-1173: avoid duplicate string lint errors)
const TEST_PATH_A = 'src/a.ts';
const TEST_PATH_B = 'src/b.ts';
const TEST_PATH_C = 'src/c.ts';
const TEST_ARGV_PREFIX = ['node', 'test.js'] as const;
const FLAG_CODE_PATHS = '--code-paths';
// WU-1300: Additional constants for lint compliance
const FLAG_CODE_PATH = '--code-path';
const FLAG_MANUAL_TEST = '--manual-test';
const TEST_PARSER_NAME = 'test';
const TEST_PARSER_CONFIG_DESC = 'Test parser';
const MANUAL_TEST_PATH_A = 'tests/manual/a.test.ts';
const MANUAL_TEST_PATH_B = 'tests/manual/b.test.ts';

describe('arg-parser', () => {
  describe('WUOption interface', () => {
    it('should accept type property for option type hints', () => {
      // WU-1306: WUOption interface must support type property used by CLI commands
      const option = {
        name: 'test',
        flags: '--test',
        description: 'Test option',
        type: 'boolean' as const,
      };
      // If WUOption interface doesn't include type, this would fail TypeScript compilation
      // Runtime check: createWUParser should accept options with type property
      const parser = createWUParser({
        name: 'type-test',
        description: 'Test type property',
        options: [option],
        required: [],
      });
      expect(parser).toBeDefined();
    });

    it('should accept required property for option requirement hints', () => {
      // WU-1306: WUOption interface must support required property
      const option = {
        name: 'test',
        flags: '--test <value>',
        description: 'Test option',
        required: true,
      };
      const parser = createWUParser({
        name: 'required-test',
        description: 'Test required property',
        options: [option],
        required: [],
      });
      expect(parser).toBeDefined();
    });
  });

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

      // WU-1173: All array flags should be marked as repeatable for consistency
      it('should mark codePaths as repeatable', () => {
        expect(WU_OPTIONS.codePaths.name).toBe('codePaths');
        expect(WU_OPTIONS.codePaths.isRepeatable).toBe(true);
      });

      it('should mark testPathsManual as repeatable', () => {
        expect(WU_OPTIONS.testPathsManual.name).toBe('testPathsManual');
        expect(WU_OPTIONS.testPathsManual.isRepeatable).toBe(true);
      });

      it('should mark testPathsUnit as repeatable', () => {
        expect(WU_OPTIONS.testPathsUnit.name).toBe('testPathsUnit');
        expect(WU_OPTIONS.testPathsUnit.isRepeatable).toBe(true);
      });

      it('should mark testPathsE2e as repeatable', () => {
        expect(WU_OPTIONS.testPathsE2e.name).toBe('testPathsE2e');
        expect(WU_OPTIONS.testPathsE2e.isRepeatable).toBe(true);
      });

      it('should mark specRefs as repeatable', () => {
        expect(WU_OPTIONS.specRefs.name).toBe('specRefs');
        expect(WU_OPTIONS.specRefs.isRepeatable).toBe(true);
      });

      it('should mark uiPairingWus as repeatable', () => {
        expect(WU_OPTIONS.uiPairingWus.name).toBe('uiPairingWus');
        expect(WU_OPTIONS.uiPairingWus.isRepeatable).toBe(true);
      });

      it('should mark blockedBy as repeatable', () => {
        expect(WU_OPTIONS.blockedBy.name).toBe('blockedBy');
        expect(WU_OPTIONS.blockedBy.isRepeatable).toBe(true);
      });

      it('should mark blocks as repeatable', () => {
        expect(WU_OPTIONS.blocks.name).toBe('blocks');
        expect(WU_OPTIONS.blocks.isRepeatable).toBe(true);
      });

      it('should mark labels as repeatable', () => {
        expect(WU_OPTIONS.labels.name).toBe('labels');
        expect(WU_OPTIONS.labels.isRepeatable).toBe(true);
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

    // WU-1681: Client option descriptions must be neutral and list codex-cli
    describe('client-neutral descriptions (WU-1681)', () => {
      it('should include codex-cli in client option description', () => {
        expect(WU_OPTIONS.client.description).toContain('codex-cli');
      });

      it('should list multiple clients alphabetically in client description', () => {
        const desc = WU_OPTIONS.client.description;
        expect(desc).toContain('claude-code');
        expect(desc).toContain('codex-cli');
        expect(desc).toContain('gemini-cli');
      });

      it('should mark codex option description as deprecated', () => {
        expect(WU_OPTIONS.codex.description).toContain('Deprecated');
        expect(WU_OPTIONS.codex.description).toContain('codex-cli');
      });
    });

    describe('cloud mode options (WU-1491)', () => {
      it('should define cloud option', () => {
        expect(WU_OPTIONS.cloud.name).toBe('cloud');
        expect(WU_OPTIONS.cloud.flags).toBe('--cloud');
        expect(WU_OPTIONS.cloud.description).toContain('cloud');
      });

      it('should parse --cloud flag', () => {
        process.argv = ['node', 'test.js', '--cloud'];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.cloud],
        });

        expect(opts.cloud).toBe(true);
      });
    });

    // WU-1494: --pr-draft parser/help parity
    describe('PR draft option (WU-1494)', () => {
      it('should define prDraft option', () => {
        expect(WU_OPTIONS.prDraft).toBeDefined();
        expect(WU_OPTIONS.prDraft.name).toBe('prDraft');
        expect(WU_OPTIONS.prDraft.flags).toBe('--pr-draft');
        expect(WU_OPTIONS.prDraft.description).toContain('draft');
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

    it('should define sizing options', () => {
      expect(WU_CREATE_OPTIONS.estimatedFiles.flags).toBe('--estimated-files <count>');
      expect(WU_CREATE_OPTIONS.estimatedToolCalls.flags).toBe('--estimated-tool-calls <count>');
      expect(WU_CREATE_OPTIONS.sizingStrategy.flags).toBe('--sizing-strategy <strategy>');
      expect(WU_CREATE_OPTIONS.sizingExceptionType.flags).toBe('--sizing-exception-type <type>');
      expect(WU_CREATE_OPTIONS.sizingExceptionReason.flags).toBe(
        '--sizing-exception-reason <text>',
      );
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
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.id, WU_OPTIONS.lane],
      });

      expect(opts.id).toBe('WU-123');
      expect(opts.lane).toBe('Framework: Core');
    });

    it('should parse short flags', () => {
      process.argv = ['node', 'test.js', '-i', 'WU-456', '-l', 'Operations'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.id, WU_OPTIONS.lane],
      });

      expect(opts.id).toBe('WU-456');
      expect(opts.lane).toBe('Operations');
    });

    it('should parse boolean flags', () => {
      process.argv = ['node', 'test.js', '--force', '--skip-gates'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.force, WU_OPTIONS.skipGates],
      });

      expect(opts.force).toBe(true);
      expect(opts.skipGates).toBe(true);
    });

    it('should handle positional ID when allowPositionalId is true', () => {
      process.argv = ['node', 'test.js', 'WU-789'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.id],
        allowPositionalId: true,
      });

      expect(opts.id).toBe('WU-789');
    });

    it('should prefer flag over positional', () => {
      process.argv = ['node', 'test.js', '--id', 'WU-FLAG', 'WU-POSITIONAL'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.id],
        allowPositionalId: true,
      });

      expect(opts.id).toBe('WU-FLAG');
    });

    it('should filter pnpm -- separator', () => {
      process.argv = ['node', 'test.js', '--', '--id', 'WU-123'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
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
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.acceptance],
      });

      expect(opts.acceptance).toEqual(['Criterion 1', 'Criterion 2']);
    });

    it('should throw ProcessExitError for --help instead of calling process.exit', () => {
      process.argv = ['node', 'test.js', '--help'];

      expect(() =>
        createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.id],
        }),
      ).toThrow(ProcessExitError);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should throw ProcessExitError with exit code 0 for --help', () => {
      process.argv = ['node', 'test.js', '--help'];

      try {
        createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.id],
        });
        throw new Error('Expected ProcessExitError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessExitError);
        expect((err as ProcessExitError).exitCode).toBe(0);
      }
    });

    it('should parse custom --version option without Commander flag conflicts', () => {
      process.argv = [...TEST_ARGV_PREFIX, '--version', '1.2.3'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [
          {
            name: 'version',
            flags: '--version <version>',
            description: 'Custom version input',
          },
        ],
      });

      expect(opts.version).toBe('1.2.3');
    });

    it('should preserve built-in --version behavior when no custom version option is defined', () => {
      process.argv = [...TEST_ARGV_PREFIX, '--version'];

      expect(() =>
        createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.id],
        }),
      ).toThrow(ProcessExitError);
    });

    it('should return empty array for unused repeatable options', () => {
      process.argv = ['node', 'test.js'];

      const opts = createWUParser({
        name: TEST_PARSER_NAME,
        description: TEST_PARSER_CONFIG_DESC,
        options: [WU_OPTIONS.acceptance],
      });

      expect(opts.acceptance).toEqual([]);
    });

    // WU-1173: All array flags should support both repeatable and comma-separated patterns
    describe('array flag consistency (WU-1173)', () => {
      it('should parse --code-paths with repeatable pattern', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          FLAG_CODE_PATHS,
          TEST_PATH_A,
          FLAG_CODE_PATHS,
          TEST_PATH_B,
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.codePaths],
        });

        expect(opts.codePaths).toEqual([TEST_PATH_A, TEST_PATH_B]);
      });

      it('should treat comma-separated value as single item (not split)', () => {
        // Per Commander.js best practices: comma-separated is a separate pattern
        // Use repeatable (--flag a --flag b) for multi-value options
        const commaValue = `${TEST_PATH_A},${TEST_PATH_B}`;
        process.argv = [...TEST_ARGV_PREFIX, FLAG_CODE_PATHS, commaValue];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.codePaths],
        });

        // Comma-separated value is preserved as single item (not split)
        expect(opts.codePaths).toEqual([commaValue]);
      });

      it('should handle multiple repeatable flags correctly', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          FLAG_CODE_PATHS,
          TEST_PATH_A,
          FLAG_CODE_PATHS,
          TEST_PATH_B,
          FLAG_CODE_PATHS,
          TEST_PATH_C,
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.codePaths],
        });

        expect(opts.codePaths).toEqual([TEST_PATH_A, TEST_PATH_B, TEST_PATH_C]);
      });

      it('should parse --test-paths-unit with repeatable pattern', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          '--test-paths-unit',
          'tests/a.test.ts',
          '--test-paths-unit',
          'tests/b.test.ts',
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.testPathsUnit],
        });

        expect(opts.testPathsUnit).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
      });

      it('should parse --spec-refs with repeatable pattern', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          '--spec-refs',
          'docs/plan-a.md',
          '--spec-refs',
          'docs/plan-b.md',
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.specRefs],
        });

        expect(opts.specRefs).toEqual(['docs/plan-a.md', 'docs/plan-b.md']);
      });

      it('should handle empty values for array flags', () => {
        process.argv = [...TEST_ARGV_PREFIX];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.codePaths, WU_OPTIONS.testPathsUnit, WU_OPTIONS.specRefs],
        });

        expect(opts.codePaths).toEqual([]);
        expect(opts.testPathsUnit).toEqual([]);
        expect(opts.specRefs).toEqual([]);
      });

      it('should parse --blocked-by with repeatable pattern', () => {
        process.argv = [...TEST_ARGV_PREFIX, '--blocked-by', 'WU-100', '--blocked-by', 'WU-200'];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.blockedBy],
        });

        expect(opts.blockedBy).toEqual(['WU-100', 'WU-200']);
      });

      it('should parse --labels with repeatable pattern', () => {
        process.argv = [...TEST_ARGV_PREFIX, '--labels', 'urgent', '--labels', 'bug'];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.labels],
        });

        expect(opts.labels).toEqual(['urgent', 'bug']);
      });
    });

    // WU-1494: --pr-draft parsing via createWUParser
    describe('--pr-draft parsing (WU-1494)', () => {
      it('should parse --pr-draft flag', () => {
        process.argv = [...TEST_ARGV_PREFIX, '--create-pr', '--pr-draft'];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.createPr, WU_OPTIONS.prDraft],
        });

        expect(opts.createPr).toBe(true);
        expect(opts.prDraft).toBe(true);
      });

      it('should not set prDraft when --pr-draft is not provided', () => {
        process.argv = [...TEST_ARGV_PREFIX, '--create-pr'];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          options: [WU_OPTIONS.createPr, WU_OPTIONS.prDraft],
        });

        expect(opts.createPr).toBe(true);
        expect(opts.prDraft).toBeUndefined();
      });
    });

    // WU-1300: CLI aliases for convenience
    describe('CLI aliases (WU-1300)', () => {
      it('should accept --code-path as alias for --code-paths', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          FLAG_CODE_PATH,
          TEST_PATH_A,
          FLAG_CODE_PATH,
          TEST_PATH_B,
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          // Include both canonical and alias options
          options: [WU_OPTIONS.codePaths, WU_OPTIONS.codePath],
        });

        // Alias --code-path should populate codePaths array
        expect(opts.codePaths).toEqual([TEST_PATH_A, TEST_PATH_B]);
      });

      it('should accept --manual-test as alias for --test-paths-manual', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          FLAG_MANUAL_TEST,
          MANUAL_TEST_PATH_A,
          FLAG_MANUAL_TEST,
          MANUAL_TEST_PATH_B,
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          // Include both canonical and alias options
          options: [WU_OPTIONS.testPathsManual, WU_OPTIONS.manualTest],
        });

        // Alias --manual-test should populate testPathsManual array
        expect(opts.testPathsManual).toEqual([MANUAL_TEST_PATH_A, MANUAL_TEST_PATH_B]);
      });

      it('should allow mixing alias and canonical flag', () => {
        process.argv = [
          ...TEST_ARGV_PREFIX,
          '--code-paths',
          TEST_PATH_A,
          FLAG_CODE_PATH,
          TEST_PATH_B,
        ];

        const opts = createWUParser({
          name: TEST_PARSER_NAME,
          description: TEST_PARSER_CONFIG_DESC,
          // Include both canonical and alias options
          options: [WU_OPTIONS.codePaths, WU_OPTIONS.codePath],
        });

        // Both --code-paths and --code-path should contribute to codePaths array
        expect(opts.codePaths).toEqual([TEST_PATH_A, TEST_PATH_B]);
      });
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

    // WU-1494: --pr-draft accepted by parseWUArgs (used by wu:done)
    it('should parse --pr-draft flag via parseWUArgs', () => {
      const argv = ['node', 'test.js', '--id', 'WU-100', '--create-pr', '--pr-draft'];

      const opts = parseWUArgs(argv);

      expect(opts.createPr).toBe(true);
      expect(opts.prDraft).toBe(true);
    });

    it('should parse --create-pr without --pr-draft via parseWUArgs', () => {
      const argv = ['node', 'test.js', '--id', 'WU-100', '--create-pr'];

      const opts = parseWUArgs(argv);

      expect(opts.createPr).toBe(true);
      expect(opts.prDraft).toBeUndefined();
    });
  });
});
