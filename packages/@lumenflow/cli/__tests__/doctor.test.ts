/**
 * @file doctor.test.ts
 * Test suite for lumenflow doctor command (WU-1177)
 * Verifies safety components, vendor configs, and outputs health status
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Test constant for config file name to avoid sonarjs/no-duplicate-string */
const LUMENFLOW_CONFIG_FILE = '.lumenflow.config.yaml';

describe('lumenflow doctor command (WU-1177)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-doctor-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to setup a mock LumenFlow project with specified components
   */
  function setupMockProject(options: {
    husky?: boolean;
    safeGit?: boolean;
    agentsMd?: boolean;
    claudeMd?: boolean;
    cursorRules?: boolean;
    windsurfRules?: boolean;
    clineRules?: boolean;
    lumenflowConfig?: boolean;
  }): void {
    if (options.husky) {
      fs.mkdirSync(path.join(tempDir, '.husky'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, '.husky', 'pre-commit'), '#!/bin/sh\nexit 0');
    }

    if (options.safeGit) {
      fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'scripts', 'safe-git'), '#!/bin/bash\nexit 0');
    }

    if (options.agentsMd) {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Universal Agent Instructions\n');
    }

    if (options.claudeMd) {
      fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Claude Code Instructions\n');
    }

    if (options.cursorRules) {
      fs.mkdirSync(path.join(tempDir, '.cursor', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.cursor', 'rules', 'lumenflow.md'),
        '# Cursor LumenFlow Rules\n',
      );
    }

    if (options.windsurfRules) {
      fs.mkdirSync(path.join(tempDir, '.windsurf', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.windsurf', 'rules', 'lumenflow.md'),
        '# Windsurf LumenFlow Rules\n',
      );
    }

    if (options.clineRules) {
      fs.writeFileSync(path.join(tempDir, '.clinerules'), '# Cline LumenFlow Rules\n');
    }

    if (options.lumenflowConfig) {
      fs.writeFileSync(path.join(tempDir, LUMENFLOW_CONFIG_FILE), 'version: 1.0\n');
    }
  }

  describe('runDoctor', () => {
    it('should return ACTIVE status when all safety components are present', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.status).toBe('ACTIVE');
      expect(result.checks.husky.passed).toBe(true);
      expect(result.checks.safeGit.passed).toBe(true);
      expect(result.checks.agentsMd.passed).toBe(true);
    });

    it('should return INCOMPLETE status when husky is missing', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.status).toBe('INCOMPLETE');
      expect(result.checks.husky.passed).toBe(false);
      expect(result.checks.husky.message).toContain('Husky');
    });

    it('should return INCOMPLETE status when safe-git is missing', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.status).toBe('INCOMPLETE');
      expect(result.checks.safeGit.passed).toBe(false);
    });

    it('should return INCOMPLETE status when AGENTS.md is missing', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.status).toBe('INCOMPLETE');
      expect(result.checks.agentsMd.passed).toBe(false);
    });
  });

  describe('vendor config checks', () => {
    it('should check for Claude config when CLAUDE.md exists', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        claudeMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.vendorConfigs.claude.present).toBe(true);
    });

    it('should check for Cursor config when .cursor/rules/lumenflow.md exists', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        cursorRules: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.vendorConfigs.cursor.present).toBe(true);
    });

    it('should check for Windsurf config when .windsurf/rules/lumenflow.md exists', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        windsurfRules: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.vendorConfigs.windsurf.present).toBe(true);
    });

    it('should check for Cline config when .clinerules exists', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        clineRules: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.vendorConfigs.cline.present).toBe(true);
    });

    it('should report multiple vendor configs when all are present', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        claudeMd: true,
        cursorRules: true,
        windsurfRules: true,
        clineRules: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.vendorConfigs.claude.present).toBe(true);
      expect(result.vendorConfigs.cursor.present).toBe(true);
      expect(result.vendorConfigs.windsurf.present).toBe(true);
      expect(result.vendorConfigs.cline.present).toBe(true);
    });
  });

  describe('Node/pnpm version checks', () => {
    it('should check Node.js version', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.prerequisites.node.version).toBeDefined();
      expect(result.prerequisites.node.passed).toBeDefined();
    });

    it('should check pnpm version', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);

      expect(result.prerequisites.pnpm.version).toBeDefined();
      expect(result.prerequisites.pnpm.passed).toBeDefined();
    });
  });

  describe('formatDoctorOutput', () => {
    it('should format output with LumenFlow safety: ACTIVE when all checks pass', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      expect(output).toContain('LumenFlow safety: ACTIVE');
    });

    it('should format output with pass symbols for passing checks', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      // Should have checkmarks for passing items
      expect(output).toMatch(/[✓✔]/);
      expect(output).toContain('Husky');
    });

    it('should format output with fail symbols for failing checks', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        agentsMd: true,
        lumenflowConfig: true,
        // Missing husky and safe-git
      });

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      // Should have X marks for failing items
      expect(output).toMatch(/[✗✘]/);
    });

    it('should include vendor config section in output', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        claudeMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      expect(output).toContain('claude');
    });

    it('should output LumenFlow safety: INCOMPLETE when checks fail', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        agentsMd: true,
        // Missing critical components
      });

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      expect(output).toContain('LumenFlow safety: INCOMPLETE');
    });
  });

  describe('CLI argument parsing', () => {
    let originalArgv: string[];

    beforeEach(() => {
      originalArgv = process.argv;
    });

    afterEach(() => {
      process.argv = originalArgv;
      vi.resetModules();
    });

    it('should show help when --help flag is passed', async () => {
      process.argv = ['node', 'lumenflow-doctor', '--help'];

      const { parseDoctorOptions } = await import('../src/doctor.js');

      expect(() => parseDoctorOptions()).toThrow();
    });
  });

  /**
   * WU-1191: Lane health check integration
   * Tests for integrating lane:health into lumenflow doctor
   */
  describe('lane health check (WU-1191)', () => {
    it('should include lane health check in doctor result', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      // Setup a valid project with lane definitions
      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      // Add lane definitions to config
      fs.writeFileSync(
        path.join(tempDir, LUMENFLOW_CONFIG_FILE),
        `version: '2.0'
lanes:
  definitions:
    - name: 'Framework: Core'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/core/**'
    - name: 'Framework: CLI'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/cli/**'
`,
      );

      const result = await runDoctor(tempDir);

      // Should have a laneHealth check in the result
      expect(result.checks.laneHealth).toBeDefined();
      expect(result.checks.laneHealth.passed).toBeDefined();
      expect(typeof result.checks.laneHealth.message).toBe('string');
    });

    it('should report lane health issues when overlaps detected', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      // Create overlapping lane definitions
      fs.writeFileSync(
        path.join(tempDir, LUMENFLOW_CONFIG_FILE),
        `version: '2.0'
lanes:
  definitions:
    - name: 'Framework: Core'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/**'
    - name: 'Framework: CLI'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/cli/**'
`,
      );

      const result = await runDoctor(tempDir);

      expect(result.checks.laneHealth).toBeDefined();
      expect(result.checks.laneHealth.passed).toBe(false);
      expect(result.checks.laneHealth.message).toContain('overlap');
    });

    it('should pass lane health check when configuration is valid', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      // Create non-overlapping lane definitions
      fs.writeFileSync(
        path.join(tempDir, LUMENFLOW_CONFIG_FILE),
        `version: '2.0'
lanes:
  definitions:
    - name: 'Framework: Core'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/core/**'
    - name: 'Content: Documentation'
      wip_limit: 1
      code_paths:
        - 'docs/**'
`,
      );

      const result = await runDoctor(tempDir);

      expect(result.checks.laneHealth).toBeDefined();
      expect(result.checks.laneHealth.passed).toBe(true);
    });

    it('should skip lane health check when no lane definitions exist', async () => {
      const { runDoctor } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      // Config without lane definitions
      fs.writeFileSync(
        path.join(tempDir, LUMENFLOW_CONFIG_FILE),
        `version: '2.0'
project: test
`,
      );

      const result = await runDoctor(tempDir);

      // Should still have the check but indicate no lanes configured
      expect(result.checks.laneHealth).toBeDefined();
      expect(result.checks.laneHealth.passed).toBe(true);
      expect(result.checks.laneHealth.message).toContain('No lane definitions');
    });

    it('should include lane health details in formatted output', async () => {
      const { runDoctor, formatDoctorOutput } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      fs.writeFileSync(
        path.join(tempDir, LUMENFLOW_CONFIG_FILE),
        `version: '2.0'
lanes:
  definitions:
    - name: 'Framework: Core'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/core/**'
`,
      );

      const result = await runDoctor(tempDir);
      const output = formatDoctorOutput(result);

      expect(output).toContain('Lane Health');
    });
  });
});
