/**
 * Tests for CLI documentation generator
 *
 * TDD: These tests define expected behavior BEFORE implementation.
 *
 * @module docs-generate.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('docs:generate', () => {
  const ROOT = join(__dirname, '../../../..');
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `docs-generate-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('CLI reference generation', () => {
    it('should extract all WU_OPTIONS from @lumenflow/core', async () => {
      // Import WU_OPTIONS directly - this is the source of truth
      const { WU_OPTIONS } = await import('@lumenflow/core');

      // Verify WU_OPTIONS exists and has entries
      expect(WU_OPTIONS).toBeDefined();
      expect(Object.keys(WU_OPTIONS).length).toBeGreaterThan(50);

      // Each option should have required fields
      for (const [_key, option] of Object.entries(WU_OPTIONS)) {
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
      const result = execSync('pnpm docs:generate', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result).toContain('Documentation generated successfully');

      // Check output file exists
      const cliPath = join(ROOT, 'apps/docs/src/content/docs/reference/cli.mdx');
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
      execSync('pnpm docs:generate', {
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

      // Zod 4 has native toJSONSchema() method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schema = DirectoriesSchema as any;
      expect(typeof schema.toJSONSchema).toBe('function');

      const jsonSchema = schema.toJSONSchema();
      expect(jsonSchema).toHaveProperty('type', 'object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });

  describe('docs:validate', () => {
    it('should detect drift when generated differs from committed', { timeout: 60000 }, () => {
      // First ensure we have fresh generated docs
      execSync('pnpm docs:generate', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Now modify the file to create drift
      const cliPath = join(ROOT, 'apps/docs/src/content/docs/reference/cli.mdx');
      const original = readFileSync(cliPath, 'utf-8');

      // Add fake content to simulate drift
      writeFileSync(cliPath, original + '\n<!-- MODIFIED -->');

      try {
        // Validate should detect drift and exit with code 1
        execSync('pnpm docs:validate', {
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
      execSync('pnpm docs:generate', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // Validate should pass (exit 0)
      const result = execSync('pnpm docs:validate', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result).toContain('up to date');
    });
  });

  describe('Quality requirements', () => {
    it('should escape MDX special characters in generated CLI output', { timeout: 60000 }, () => {
      // Generate docs
      execSync('pnpm docs:generate', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const cliPath = join(ROOT, 'apps/docs/src/content/docs/reference/cli.mdx');
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
