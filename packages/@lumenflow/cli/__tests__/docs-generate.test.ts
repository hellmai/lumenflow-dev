/**
 * Tests for CLI documentation generator
 *
 * TDD: These tests define expected behavior BEFORE implementation.
 *
 * These tests use execSync to run pnpm scripts. The sonarjs security rules
 * are disabled at file level because:
 * 1. Commands are hardcoded constants, not user input
 * 2. This is test code that runs in controlled CI environments
 * 3. The pnpm scripts are part of this trusted monorepo
 *
 * @module docs-generate.test
 */

/* eslint-disable sonarjs/no-os-command-from-path, sonarjs/os-command */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Test-specific constants for pnpm commands
const DOCS_GENERATE_CMD = 'pnpm docs:generate';
const DOCS_VALIDATE_CMD = 'pnpm docs:validate';
const CLI_MDX_PATH = 'apps/docs/src/content/docs/reference/cli.mdx';
const CONFIG_MDX_PATH = 'apps/docs/src/content/docs/reference/config.mdx';
const README_PATH = 'packages/@lumenflow/cli/README.md';
const GENERATED_TRACKED_FILES = [CLI_MDX_PATH, CONFIG_MDX_PATH, README_PATH] as const;

interface FileSnapshot {
  existed: boolean;
  content: string;
}

describe('docs:generate', () => {
  const ROOT = join(__dirname, '../../../..');
  let tempDir: string;
  const fileSnapshots = new Map<string, FileSnapshot>();

  function snapshotGeneratedFiles() {
    for (const relPath of GENERATED_TRACKED_FILES) {
      const absPath = join(ROOT, relPath);
      if (existsSync(absPath)) {
        fileSnapshots.set(relPath, {
          existed: true,
          content: readFileSync(absPath, 'utf-8'),
        });
      } else {
        fileSnapshots.set(relPath, {
          existed: false,
          content: '',
        });
      }
    }
  }

  function restoreGeneratedFiles() {
    for (const relPath of GENERATED_TRACKED_FILES) {
      const snapshot = fileSnapshots.get(relPath);
      if (!snapshot) continue;

      const absPath = join(ROOT, relPath);
      if (snapshot.existed) {
        writeFileSync(absPath, snapshot.content);
      } else if (existsSync(absPath)) {
        rmSync(absPath);
      }
    }
  }

  beforeAll(() => {
    // Guard against docs generation tests leaving tracked files dirty in main checkout.
    snapshotGeneratedFiles();
  });

  beforeEach(() => {
    tempDir = join(tmpdir(), `docs-generate-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    restoreGeneratedFiles();

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    restoreGeneratedFiles();
  });

  describe('CLI reference generation', () => {
    it('should extract all WU_OPTIONS from @lumenflow/core', { timeout: 20000 }, async () => {
      // Import WU_OPTIONS directly - this is the source of truth
      const { WU_OPTIONS } = await import('@lumenflow/core');

      // Verify WU_OPTIONS exists and has entries
      expect(WU_OPTIONS).toBeDefined();
      expect(Object.keys(WU_OPTIONS).length).toBeGreaterThan(50);

      // Each option should have required fields
      for (const option of Object.values(WU_OPTIONS)) {
        expect(option).toHaveProperty('name');
        expect(option).toHaveProperty('flags');
        expect(option).toHaveProperty('description');
        expect(typeof option.name).toBe('string');
        expect(typeof option.flags).toBe('string');
        expect(typeof option.description).toBe('string');
      }
    });

    it('should have all 46+ commands in package.json bin', () => {
      const pkgPath = join(ROOT, 'packages/@lumenflow/cli/package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      const binEntries = Object.keys(pkg.bin || {});
      expect(binEntries.length).toBeGreaterThanOrEqual(46);

      // Key commands should exist
      expect(binEntries).toContain('wu-claim');
      expect(binEntries).toContain('wu-done');
      expect(binEntries).toContain('wu-create');
      expect(binEntries).toContain('gates');
    });

    it('should run docs:generate and create cli.mdx', { timeout: 60000 }, () => {
      // Run the generator
      const result = execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result).toContain('Documentation generated successfully');

      // Check output file exists
      const cliPath = join(ROOT, CLI_MDX_PATH);
      expect(existsSync(cliPath)).toBe(true);

      // Read and validate content
      const content = readFileSync(cliPath, 'utf-8');

      // Should have frontmatter
      expect(content).toContain('---');
      expect(content).toContain('title: CLI Commands');

      // Should have auto-generated marker
      expect(content).toContain('AUTO-GENERATED FILE');

      // Should document key commands
      expect(content).toContain('wu:claim');
      expect(content).toContain('wu:done');
      expect(content).toContain('wu:create');
    });
  });

  describe('Config reference generation', () => {
    it('should export config schemas from @lumenflow/core', async () => {
      // Import schemas directly - this is the source of truth
      const { DirectoriesSchema, GitConfigSchema, GatesConfigSchema } =
        await import('@lumenflow/core');

      // Verify schemas exist and are Zod schemas
      expect(DirectoriesSchema).toBeDefined();
      expect(GitConfigSchema).toBeDefined();
      expect(GatesConfigSchema).toBeDefined();

      // Should be parseable (Zod schemas have safeParse)
      expect(typeof DirectoriesSchema.safeParse).toBe('function');
    });

    it('should run docs:generate and create config.mdx', { timeout: 60000 }, () => {
      // Run the generator
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Check output file exists
      const configPath = join(ROOT, 'apps/docs/src/content/docs/reference/config.mdx');
      expect(existsSync(configPath)).toBe(true);

      // Read and validate content
      const content = readFileSync(configPath, 'utf-8');

      // Should have frontmatter
      expect(content).toContain('---');
      expect(content).toContain('title: Configuration');

      // Should have auto-generated marker
      expect(content).toContain('AUTO-GENERATED FILE');

      // Should document key config sections
      expect(content).toContain('directories');
      expect(content).toContain('git');
    });

    it('should use Zod 4 native toJSONSchema() for schema extraction', async () => {
      const { DirectoriesSchema } = await import('@lumenflow/core');

      // Zod 4 has native toJSONSchema() method - needs 'any' for dynamic schema access
      const schema = DirectoriesSchema as unknown as { toJSONSchema: () => object };
      expect(typeof schema.toJSONSchema).toBe('function');

      const jsonSchema = schema.toJSONSchema();
      expect(jsonSchema).toHaveProperty('type', 'object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });

  describe('docs:validate', () => {
    it('should detect drift when generated differs from committed', { timeout: 60000 }, () => {
      // First ensure we have fresh generated docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Now modify the file to create drift
      const cliPath = join(ROOT, CLI_MDX_PATH);
      const original = readFileSync(cliPath, 'utf-8');

      // Add fake content to simulate drift
      writeFileSync(cliPath, original + '\n<!-- MODIFIED -->');

      try {
        // Validate should detect drift and exit with code 1
        execSync(DOCS_VALIDATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });
        // If we get here, validation didn't fail as expected
        expect.fail('docs:validate should have exited with code 1');
      } catch (error: unknown) {
        // Expected - validation failed
        const execError = error as { status?: number; stdout?: string };
        expect(execError.status).toBe(1);
      } finally {
        // Restore original
        writeFileSync(cliPath, original);
      }
    });

    it('should pass when docs are in sync', { timeout: 60000 }, () => {
      // Generate fresh docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Validate should pass (exit 0)
      const result = execSync(DOCS_VALIDATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result).toContain('up to date');
    });
  });

  /**
   * WU-1358: AST-based option extraction tests
   *
   * The docs generator must extract options from:
   * 1. WU_OPTIONS/WU_CREATE_OPTIONS in @lumenflow/core (existing)
   * 2. Inline option objects (e.g., EDIT_OPTIONS in wu-edit.ts)
   * 3. Commander .option() calls in CLI source files
   *
   * Implementation MUST use TypeScript AST parsing (not runtime execution)
   * to safely extract options without side effects.
   */
  describe('WU-1358: AST-based option extraction', () => {
    it('should extract inline option objects (EDIT_OPTIONS) via AST', { timeout: 60000 }, () => {
      // Generate docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const cliPath = join(ROOT, CLI_MDX_PATH);
      const content = readFileSync(cliPath, 'utf-8');

      // wu:edit should have EDIT_OPTIONS extracted
      // These are defined inline in wu-edit.ts, not in WU_OPTIONS
      expect(content).toContain('--spec-file');
      expect(content).toContain('--replace-notes');
      expect(content).toContain('--replace-acceptance');
      expect(content).toContain('--replace-code-paths');
      expect(content).toContain('--replace-risks');
    });

    it(
      'should show wu:edit --replace-* flags in generated documentation',
      { timeout: 60000 },
      () => {
        // Generate docs
        execSync(DOCS_GENERATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });

        const cliPath = join(ROOT, CLI_MDX_PATH);
        const content = readFileSync(cliPath, 'utf-8');

        // Find the wu:edit section
        const wuEditSection = content.substring(
          content.indexOf('### wu:edit'),
          content.indexOf('### wu:infer-lane') || content.indexOf('### wu:preflight'),
        );

        // Should contain all EDIT_OPTIONS flags
        expect(wuEditSection).toContain('--replace-notes');
        expect(wuEditSection).toContain('--replace-acceptance');
        expect(wuEditSection).toContain('--replace-code-paths');
        expect(wuEditSection).toContain('Replace existing');
      },
    );

    it('should use AST parsing, not runtime execution', () => {
      // The generator should NOT execute CLI files to extract options
      // Verify by checking the generator uses TypeScript compiler API
      const generatorPath = join(ROOT, 'tools/generate-cli-docs.ts');
      const generatorContent = readFileSync(generatorPath, 'utf-8');

      // Should use TypeScript for AST parsing (or ts-morph)
      expect(
        generatorContent.includes('typescript') ||
          generatorContent.includes('ts-morph') ||
          generatorContent.includes('ts.createSourceFile') ||
          generatorContent.includes('extractOptionsFromAST'),
      ).toBe(true);

      // Should NOT execute CLI binaries during docs generation
      expect(generatorContent).not.toContain('execSync(binName');
      expect(generatorContent).not.toContain('spawn(binPath');
    });

    it(
      'should extract options from createWUParser inline options arrays',
      { timeout: 60000 },
      () => {
        // Generate docs
        execSync(DOCS_GENERATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });

        const cliPath = join(ROOT, CLI_MDX_PATH);
        const content = readFileSync(cliPath, 'utf-8');

        // wu:edit uses both WU_OPTIONS and EDIT_OPTIONS in createWUParser
        // The docs should show options from both sources
        const wuEditSection = content.substring(
          content.indexOf('### wu:edit'),
          content.indexOf('### wu:infer-lane') || content.indexOf('### wu:preflight'),
        );

        // From WU_OPTIONS
        expect(wuEditSection).toContain('--id');

        // From EDIT_OPTIONS (inline)
        expect(wuEditSection).toContain('--spec-file');
        expect(wuEditSection).toContain('--description');
        expect(wuEditSection).toContain('--acceptance');
        expect(wuEditSection).toContain('--notes');
      },
    );

    it('should document all commands with complete option lists', { timeout: 60000 }, () => {
      // Generate docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const cliPath = join(ROOT, CLI_MDX_PATH);
      const content = readFileSync(cliPath, 'utf-8');

      // Commands that define inline options should have them documented
      // wu:edit has EDIT_OPTIONS
      expect(content).toContain('Replace existing notes');
      expect(content).toContain('Replace existing acceptance');

      // wu:claim should have its options documented (from WU_OPTIONS)
      const wuClaimSection = content.substring(
        content.indexOf('### wu:claim'),
        content.indexOf('### wu:cleanup'),
      );
      expect(wuClaimSection).toContain('--id');
      expect(wuClaimSection).toContain('--lane');
      expect(wuClaimSection).toContain('--branch-only');
    });
  });

  /**
   * WU-1371: Auto-generate CLI README.md from docs generator
   *
   * Extend tools/generate-cli-docs.ts to also generate packages/@lumenflow/cli/README.md
   * from the same source data used for Starlight cli.mdx. This eliminates manual
   * maintenance drift between README.md and cli.mdx.
   */
  describe('WU-1371: README.md generation', () => {
    it('should generate README.md with auto-generated marker', { timeout: 60000 }, () => {
      // Run the generator
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Check README.md exists
      const readmePath = join(ROOT, README_PATH);
      expect(existsSync(readmePath)).toBe(true);

      // Read and validate content
      const content = readFileSync(readmePath, 'utf-8');

      // Should have auto-generated marker for the Commands section
      expect(content).toContain('AUTO-GENERATED');
    });

    it('should include all bin entries in README.md command tables', { timeout: 60000 }, () => {
      // Run the generator
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Read package.json for bin entries
      const pkgPath = join(ROOT, 'packages/@lumenflow/cli/package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const binEntries = Object.keys(pkg.bin || {});

      // Read generated README.md
      const readmePath = join(ROOT, README_PATH);
      const content = readFileSync(readmePath, 'utf-8');

      // Key commands should be documented in README
      // Skip aliases (lumenflow-gates -> gates, lumenflow-validate -> validate, etc.)
      const aliasPatterns = [
        'lumenflow-gates',
        'lumenflow-validate',
        'lumenflow-doctor',
        'init-plan',
        'metrics',
        'sync-templates',
      ];
      const nonAliasCommands = binEntries.filter((cmd) => !aliasPatterns.includes(cmd));

      // At minimum, core commands should be present
      expect(content).toContain('wu-claim');
      expect(content).toContain('wu-done');
      expect(content).toContain('wu-create');
      expect(content).toContain('gates');
      expect(content).toContain('mem-checkpoint');
      expect(content).toContain('initiative-create');

      // Count how many bin entries are documented
      const documentedCount = nonAliasCommands.filter((cmd) => content.includes(cmd)).length;

      // Should document at least 90% of non-alias commands
      expect(documentedCount).toBeGreaterThanOrEqual(Math.floor(nonAliasCommands.length * 0.9));
    });

    it(
      'should maintain same command tables as manual README.md version',
      { timeout: 60000 },
      () => {
        // Run the generator
        execSync(DOCS_GENERATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });

        const readmePath = join(ROOT, README_PATH);
        const content = readFileSync(readmePath, 'utf-8');

        // Should have command category sections like the manual version
        expect(content).toContain('### Work Unit Management');
        expect(content).toContain('### Memory & Session');
        expect(content).toContain('### Initiative Orchestration');
        expect(content).toContain('### Verification & Gates');
      },
    );

    it('docs:validate should check README.md for drift', { timeout: 60000 }, () => {
      // First ensure we have fresh generated docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Now modify the README to create drift
      const readmePath = join(ROOT, README_PATH);
      const original = readFileSync(readmePath, 'utf-8');

      // Add fake content to simulate drift
      writeFileSync(readmePath, original + '\n<!-- MODIFIED -->');

      try {
        // Validate should detect drift and exit with code 1
        execSync(DOCS_VALIDATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });
        // If we get here, validation didn't fail as expected
        expect.fail('docs:validate should have exited with code 1 for README drift');
      } catch (error: unknown) {
        // Expected - validation failed
        const execError = error as { status?: number; stdout?: string };
        expect(execError.status).toBe(1);
      } finally {
        // Restore original
        writeFileSync(readmePath, original);
      }
    });

    it(
      'should preserve static README.md sections (badges, installation, etc.)',
      { timeout: 60000 },
      () => {
        // Run the generator
        execSync(DOCS_GENERATE_CMD, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });

        const readmePath = join(ROOT, README_PATH);
        const content = readFileSync(readmePath, 'utf-8');

        // Static sections that should be preserved
        expect(content).toContain('# @lumenflow/cli');
        expect(content).toContain('## Installation');
        expect(content).toContain('## Quick Start');
        expect(content).toContain('## License');
        expect(content).toContain('Apache-2.0');

        // Badges should be preserved
        expect(content).toContain('npm version');
        expect(content).toContain('img.shields.io');
      },
    );
  });

  describe('Quality requirements', () => {
    it('should escape MDX special characters in generated CLI output', { timeout: 60000 }, () => {
      // Generate docs
      execSync(DOCS_GENERATE_CMD, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const cliPath = join(ROOT, CLI_MDX_PATH);
      const content = readFileSync(cliPath, 'utf-8');

      // Angle brackets in tables should be escaped
      // Look for flags like --id <wuId> which need escaping
      const tableRows = content.split('\n').filter((line) => line.startsWith('|'));

      for (const row of tableRows) {
        // Should not have unescaped < > in table cells (outside backticks)
        // This regex checks for < or > not inside backticks
        const cellsWithoutCode = row.replace(/`[^`]+`/g, '');
        // Allow &lt; and &gt; which are properly escaped
        const hasUnescaped = /<[a-zA-Z]|[a-zA-Z]>/.test(cellsWithoutCode);
        if (hasUnescaped) {
          // Some false positives are OK (like comparison operators)
          // but flag patterns like <wuId> should be escaped
          expect(cellsWithoutCode).not.toMatch(/<[a-zA-Z]+Id>/);
        }
      }
    });

    it('should import WU_OPTIONS directly, not parse source with regex', async () => {
      // The generator should import WU_OPTIONS directly
      // We verify this works by checking the import succeeds
      const { WU_OPTIONS } = await import('@lumenflow/core');

      // If we can import it, the generator can too
      expect(Object.keys(WU_OPTIONS).length).toBeGreaterThan(50);

      // The generator script should NOT contain regex for parsing WU_OPTIONS
      const generatorPath = join(ROOT, 'tools/generate-cli-docs.ts');
      const generatorContent = readFileSync(generatorPath, 'utf-8');

      // Should import from package, not parse source
      expect(generatorContent).toContain("from '../packages/@lumenflow/core");
      expect(generatorContent).not.toContain('optionRegex');
    });
  });
});
