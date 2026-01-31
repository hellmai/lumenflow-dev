/**
 * @file init.test.ts
 * Tests for lumenflow init command (WU-1171)
 *
 * Tests the new --merge mode, --client flag, AGENTS.md creation,
 * and updated vendor overlay paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

// Constants to avoid sonarjs/no-duplicate-string
const LUMENFLOW_MD = 'LUMENFLOW.md';
const VENDOR_RULES_FILE = 'lumenflow.md';

describe('lumenflow init', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('AGENTS.md creation', () => {
    it('should create AGENTS.md by default', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
      };

      await scaffoldProject(tempDir, options);

      const agentsPath = path.join(tempDir, 'AGENTS.md');
      expect(fs.existsSync(agentsPath)).toBe(true);

      const content = fs.readFileSync(agentsPath, 'utf-8');
      expect(content).toContain(LUMENFLOW_MD);
      expect(content).toContain('universal');
    });

    it('should link AGENTS.md to LUMENFLOW.md', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
      };

      await scaffoldProject(tempDir, options);

      const agentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(agentsContent).toContain(`[${LUMENFLOW_MD}]`);
    });
  });

  describe('--client flag', () => {
    it('should accept --client claude', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'claude',
      };

      const result = await scaffoldProject(tempDir, options);

      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
      expect(result.created).toContain('CLAUDE.md');
    });

    it('should accept --client cursor', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'cursor',
      };

      await scaffoldProject(tempDir, options);

      // Cursor uses .cursor/rules/lumenflow.md (not .cursor/rules.md)
      expect(fs.existsSync(path.join(tempDir, '.cursor', 'rules', VENDOR_RULES_FILE))).toBe(true);
    });

    it('should accept --client windsurf', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'windsurf',
      };

      await scaffoldProject(tempDir, options);

      // Windsurf uses .windsurf/rules/lumenflow.md (not .windsurfrules)
      expect(fs.existsSync(path.join(tempDir, '.windsurf', 'rules', VENDOR_RULES_FILE))).toBe(true);
    });

    it('should accept --client codex', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'codex',
      };

      await scaffoldProject(tempDir, options);

      // Codex reads AGENTS.md directly, minimal extra config
      expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    });

    it('should accept --client all', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'all',
      };

      await scaffoldProject(tempDir, options);

      // Should create all vendor files
      expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.cursor', 'rules', VENDOR_RULES_FILE))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.windsurf', 'rules', VENDOR_RULES_FILE))).toBe(true);
    });

    it('should treat --vendor as alias for --client (backwards compatibility)', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        vendor: 'claude', // Using old --vendor flag
      };

      await scaffoldProject(tempDir, options);

      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    });
  });

  describe('--merge mode', () => {
    it('should insert LUMENFLOW block into existing file', async () => {
      // Create existing AGENTS.md
      const existingContent = '# My Project Agents\n\nCustom content here.\n';
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), existingContent);

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        merge: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      // Should preserve original content
      expect(content).toContain('# My Project Agents');
      expect(content).toContain('Custom content here.');

      // Should add LumenFlow block
      expect(content).toContain('<!-- LUMENFLOW:START -->');
      expect(content).toContain('<!-- LUMENFLOW:END -->');
      expect(content).toContain(LUMENFLOW_MD);
    });

    it('should be idempotent (running twice produces no diff)', async () => {
      // Create existing file
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# My Project\n');

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        merge: true,
      };

      // First run
      await scaffoldProject(tempDir, options);
      const firstContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      // Second run
      await scaffoldProject(tempDir, options);
      const secondContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      expect(firstContent).toBe(secondContent);
    });

    it('should preserve CRLF line endings', async () => {
      // Create existing file with CRLF
      const existingContent = '# My Project\r\n\r\nWindows style.\r\n';
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), existingContent);

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        merge: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      // Should preserve CRLF
      expect(content).toContain('\r\n');
      // Should not have mixed line endings (standalone LF without preceding CR)
      const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
      expect(lfCount).toBe(0);
    });

    it('should warn on malformed markers and append fresh block', async () => {
      // Create file with only START marker (malformed)
      const malformedContent = '# My Project\n\n<!-- LUMENFLOW:START -->\nOrphan block\n';
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), malformedContent);

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        merge: true,
      };

      const result = await scaffoldProject(tempDir, options);

      // Should have warnings about malformed markers
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.some((w) => w.includes('malformed'))).toBe(true);

      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      // Should have complete block
      expect(content).toContain('<!-- LUMENFLOW:END -->');
    });
  });

  describe('createFile mode option', () => {
    it('should skip existing files in skip mode (default)', async () => {
      const existingContent = 'Original content';
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), existingContent);

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        // Default mode is 'skip'
      };

      const result = await scaffoldProject(tempDir, options);

      expect(result.skipped).toContain('AGENTS.md');
      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite in force mode', async () => {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), 'Original');

      const options: ScaffoldOptions = {
        force: true,
        full: false,
      };

      const result = await scaffoldProject(tempDir, options);

      expect(result.created).toContain('AGENTS.md');
      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).not.toBe('Original');
    });

    it('should merge in merge mode', async () => {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Custom Header\n');

      const options: ScaffoldOptions = {
        force: false,
        full: false,
        merge: true,
      };

      const result = await scaffoldProject(tempDir, options);

      expect(result.merged).toContain('AGENTS.md');
      const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('# Custom Header');
      expect(content).toContain('<!-- LUMENFLOW:START -->');
    });
  });

  describe('vendor overlay paths', () => {
    it('should use .cursor/rules/lumenflow.md for Cursor', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'cursor',
      };

      await scaffoldProject(tempDir, options);

      // Should NOT create old path
      expect(fs.existsSync(path.join(tempDir, '.cursor', 'rules.md'))).toBe(false);
      // Should create new path
      expect(fs.existsSync(path.join(tempDir, '.cursor', 'rules', VENDOR_RULES_FILE))).toBe(true);
    });

    it('should use .windsurf/rules/lumenflow.md for Windsurf', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'windsurf',
      };

      await scaffoldProject(tempDir, options);

      // Should NOT create old path
      expect(fs.existsSync(path.join(tempDir, '.windsurfrules'))).toBe(false);
      // Should create new path
      expect(fs.existsSync(path.join(tempDir, '.windsurf', 'rules', VENDOR_RULES_FILE))).toBe(true);
    });
  });

  describe('CLAUDE.md location', () => {
    it('should create single CLAUDE.md at root only', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
        client: 'claude',
      };

      await scaffoldProject(tempDir, options);

      // Should create root CLAUDE.md
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);

      // Should NOT create .claude/CLAUDE.md (no duplication)
      expect(fs.existsSync(path.join(tempDir, '.claude', 'CLAUDE.md'))).toBe(false);
    });
  });

  // WU-1286: --full is now the default
  describe('--full default and --minimal flag', () => {
    it('should scaffold agent onboarding docs by default (full=true)', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true, // This is now the default when parsed
      };

      await scaffoldProject(tempDir, options);

      // Should create agent onboarding docs
      const onboardingDir = path.join(
        tempDir,
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      );
      expect(fs.existsSync(path.join(onboardingDir, 'quick-ref-commands.md'))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, 'first-wu-mistakes.md'))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, 'troubleshooting-wu-done.md'))).toBe(true);
    });

    it('should skip agent onboarding docs when full=false (minimal mode)', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false, // Explicitly minimal
      };

      await scaffoldProject(tempDir, options);

      // Should NOT create agent onboarding docs
      const onboardingDir = path.join(
        tempDir,
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      );
      expect(fs.existsSync(path.join(onboardingDir, 'quick-ref-commands.md'))).toBe(false);
    });

    it('should still create core files in minimal mode', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
      };

      await scaffoldProject(tempDir, options);

      // Core files should always be created
      expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'LUMENFLOW.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.lumenflow.config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.lumenflow', 'constraints.md'))).toBe(true);
    });
  });
});
