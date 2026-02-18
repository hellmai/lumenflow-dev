/**
 * Tests for pack:validate command (WU-1824)
 *
 * Acceptance criteria:
 * 1. Runs manifest schema validation
 * 2. Runs import boundary check
 * 3. Runs tool entry resolution
 * 4. Reports pass/fail per check with actionable errors
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('pack:validate command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pack-validate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeValidPack(packDir: string): void {
    mkdirSync(join(packDir, 'tools'), { recursive: true });
    writeFileSync(
      join(packDir, 'manifest.yaml'),
      [
        'id: test-pack',
        'version: 1.0.0',
        'task_types:',
        '  - task',
        'tools:',
        '  - name: fs:read',
        '    entry: tools/fs-read.ts',
        '    permission: read',
        '    required_scopes:',
        '      - type: path',
        '        pattern: "**"',
        '        access: read',
        'policies:',
        '  - id: workspace.default',
        '    trigger: on_tool_request',
        '    decision: allow',
        'evidence_types:',
        '  - trace',
        'state_aliases:',
        '  active: in_progress',
        'lane_templates:',
        '  - id: framework-core',
        '    title: Framework Core',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(packDir, 'tools', 'fs-read.ts'),
      ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join('\n'),
      'utf-8',
    );
  }

  describe('validatePack', () => {
    it('should return all checks passing for a valid pack', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'test-pack');
      writeValidPack(packDir);

      const result = await validatePack({ packRoot: packDir });

      expect(result.manifest.status).toBe('pass');
      expect(result.importBoundaries.status).toBe('pass');
      expect(result.toolEntries.status).toBe('pass');
      expect(result.integrity.status).toBe('pass');
    });

    // AC1: Runs manifest schema validation
    it('should fail manifest check for invalid manifest', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'bad-manifest');
      mkdirSync(packDir, { recursive: true });
      writeFileSync(
        join(packDir, 'manifest.yaml'),
        ['id: bad-manifest', 'version: not-semver'].join('\n'),
        'utf-8',
      );

      const result = await validatePack({ packRoot: packDir });

      expect(result.manifest.status).toBe('fail');
      expect(result.manifest.error).toBeDefined();
      expect(result.manifest.error).toContain('version');
    });

    it('should fail manifest check when manifest file is missing', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'no-manifest');
      mkdirSync(packDir, { recursive: true });

      const result = await validatePack({ packRoot: packDir });

      expect(result.manifest.status).toBe('fail');
      expect(result.manifest.error).toBeDefined();
    });

    // AC2: Runs import boundary check
    it('should fail import boundaries when pack imports escape root', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'boundary-escape');
      writeValidPack(packDir);
      writeFileSync(
        join(packDir, 'tools', 'dangerous.ts'),
        ['import "../../../../../secrets.ts";', 'export const danger = true;'].join('\n'),
        'utf-8',
      );

      const result = await validatePack({ packRoot: packDir });

      expect(result.importBoundaries.status).toBe('fail');
      expect(result.importBoundaries.error).toContain('outside pack root');
    });

    it('should fail import boundaries for disallowed bare imports', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'bare-import');
      writeValidPack(packDir);
      writeFileSync(
        join(packDir, 'tools', 'bad-import.ts'),
        ['import lodash from "lodash";', 'export const noop = lodash.noop;'].join('\n'),
        'utf-8',
      );

      const result = await validatePack({ packRoot: packDir });

      expect(result.importBoundaries.status).toBe('fail');
      expect(result.importBoundaries.error).toContain('Bare package import');
    });

    // AC3: Runs tool entry resolution
    it('should fail tool entries when entry resolves outside pack root', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'tool-escape');
      mkdirSync(join(packDir, 'tools'), { recursive: true });
      writeFileSync(
        join(packDir, 'manifest.yaml'),
        [
          'id: tool-escape',
          'version: 1.0.0',
          'task_types:',
          '  - task',
          'tools:',
          '  - name: bad:tool',
          '    entry: ../escape.ts',
          '    permission: read',
          '    required_scopes:',
          '      - type: path',
          '        pattern: "**"',
          '        access: read',
          'policies: []',
          'evidence_types: []',
          'state_aliases: {}',
          'lane_templates: []',
        ].join('\n'),
        'utf-8',
      );
      writeFileSync(
        join(packDir, 'tools', 'fs-read.ts'),
        ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join(
          '\n',
        ),
        'utf-8',
      );

      const result = await validatePack({ packRoot: packDir });

      // Manifest should pass (it parses correctly)
      expect(result.manifest.status).toBe('pass');
      // Tool entries should fail
      expect(result.toolEntries.status).toBe('fail');
      expect(result.toolEntries.error).toContain('outside pack root');
    });

    // AC4: Reports pass/fail per check with actionable errors
    it('should report integrity hash in result', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'hash-pack');
      writeValidPack(packDir);

      const result = await validatePack({ packRoot: packDir });

      expect(result.integrity.status).toBe('pass');
      expect(result.integrity.hash).toBeDefined();
      expect(typeof result.integrity.hash).toBe('string');
      // SHA-256 hex is 64 characters
      expect(result.integrity.hash).toHaveLength(64);
    });

    it('should return summary with overall pass/fail', async () => {
      const { validatePack } = await import('../pack-validate.js');

      const packDir = join(tempDir, 'summary-pack');
      writeValidPack(packDir);

      const result = await validatePack({ packRoot: packDir });

      expect(result.allPassed).toBe(true);

      // Now test with a failing pack
      const badDir = join(tempDir, 'bad-summary');
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, 'manifest.yaml'), 'id: bad\nversion: nope', 'utf-8');

      const badResult = await validatePack({ packRoot: badDir });

      expect(badResult.allPassed).toBe(false);
    });
  });

  describe('formatValidationReport', () => {
    it('should format all-pass report with check marks', async () => {
      const { formatValidationReport } = await import('../pack-validate.js');

      const report = formatValidationReport({
        manifest: { status: 'pass' },
        importBoundaries: { status: 'pass' },
        toolEntries: { status: 'pass' },
        integrity: { status: 'pass', hash: 'abc123' },
        allPassed: true,
      });

      expect(report).toContain('PASS');
      expect(report).toContain('Manifest');
      expect(report).toContain('Import');
      expect(report).toContain('Tool');
      expect(report).toContain('Integrity');
    });

    it('should format failure report with error messages', async () => {
      const { formatValidationReport } = await import('../pack-validate.js');

      const report = formatValidationReport({
        manifest: { status: 'fail', error: 'Invalid version format' },
        importBoundaries: { status: 'skip' },
        toolEntries: { status: 'skip' },
        integrity: { status: 'skip' },
        allPassed: false,
      });

      expect(report).toContain('FAIL');
      expect(report).toContain('Invalid version format');
    });
  });

  describe('pack:validate CLI exports', () => {
    it('should export main function for CLI entry', async () => {
      const mod = await import('../pack-validate.js');
      expect(typeof mod.main).toBe('function');
    });

    it('should export LOG_PREFIX constant', async () => {
      const mod = await import('../pack-validate.js');
      expect(typeof mod.LOG_PREFIX).toBe('string');
    });
  });
});
