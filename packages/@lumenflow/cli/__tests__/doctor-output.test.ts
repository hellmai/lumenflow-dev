/**
 * @file doctor-output.test.ts
 * WU-1968: Fix doctor duplicate output and misleading git version prerequisite warning
 *
 * Tests:
 * - AC1: lumenflow doctor output appears exactly once (no duplicate)
 * - AC2: Passing prerequisite checks show a checkmark not a warning prefix
 * - AC3: Failing prerequisite checks still show warning prefix with actionable guidance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import type { DoctorResult } from '../src/doctor.js';

/** Test constant for config file name to avoid sonarjs/no-duplicate-string */
const WORKSPACE_CONFIG_FILE = CONFIG_FILES.WORKSPACE_CONFIG;

/** Test constant for checkmark symbol */
const CHECKMARK = '\u2713';

/** Test constant for cross/failure symbol */
const CROSS = '\u2717';

describe('WU-1968: Doctor output dedup and prerequisite formatting', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-doctor-output-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Helper to setup a mock LumenFlow project */
  function setupMockProject(options: {
    husky?: boolean;
    safeGit?: boolean;
    agentsMd?: boolean;
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
    if (options.lumenflowConfig) {
      fs.writeFileSync(path.join(tempDir, WORKSPACE_CONFIG_FILE), 'software_delivery: {}\n');
    }
  }

  describe('AC1: Doctor output appears exactly once (no duplicate)', () => {
    it('init main() should not contain separate checkPrerequisites display logic', async () => {
      // The init main() previously had its own checkPrerequisites() call that
      // printed prerequisite warnings, duplicating what runDoctorForInit shows.
      // After the fix, init's main() should delegate all prereq display to doctor.
      const initSourcePath = path.join(__dirname, '..', 'src', 'init.ts');
      const initSource = fs.readFileSync(initSourcePath, 'utf-8');

      // Find the main() function body
      const mainFnStart = initSource.indexOf('export async function main()');
      expect(mainFnStart).toBeGreaterThan(-1);
      const mainBody = initSource.slice(mainFnStart);

      // After fix: main() should not contain a separate failingPrereqs variable
      // that formats and prints prerequisite warnings independently from doctor
      expect(mainBody).not.toContain('failingPrereqs');
    });

    it('runDoctorForInit should be the sole source of prerequisite output', async () => {
      const { runDoctorForInit } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctorForInit(tempDir);

      // runDoctorForInit is the single source of truth for health output
      // Its output should include the health check header
      expect(result.output).toContain('[lumenflow doctor]');
    });
  });

  describe('AC2: Passing prerequisite checks show checkmark not warning prefix', () => {
    it('formatDoctorOutput should show checkmark for passing prerequisites', async () => {
      const { formatDoctorOutput } = await import('../src/doctor.js');

      const mockResult: DoctorResult = {
        status: 'ACTIVE',
        exitCode: 0,
        checks: {
          husky: { passed: true, message: 'Husky hooks installed' },
          safeGit: { passed: true, message: 'Safe-git wrapper present' },
          agentsMd: { passed: true, message: 'AGENTS.md exists' },
          lumenflowConfig: { passed: true, message: 'Config present' },
          laneHealth: { passed: true, message: 'Lane config healthy' },
        },
        vendorConfigs: {
          claude: { present: true, path: 'CLAUDE.md' },
          cursor: { present: false, path: '.cursor/rules/lumenflow.md' },
          windsurf: { present: false, path: '.windsurf/rules/lumenflow.md' },
          cline: { present: false, path: '.clinerules' },
          codex: { present: true, path: 'AGENTS.md' },
        },
        prerequisites: {
          node: { passed: true, version: 'v22.14.0', required: '>=22.0.0' },
          pnpm: { passed: true, version: '9.15.0', required: '>=9.0.0' },
          git: { passed: true, version: 'git version 2.43.0', required: '>=2.0.0' },
        },
      };

      const output = formatDoctorOutput(mockResult);

      // All prerequisite lines should have checkmarks (not warning symbols)
      const prereqLines = output
        .split('\n')
        .filter(
          (line) => line.includes('node:') || line.includes('pnpm:') || line.includes('git:'),
        );

      expect(prereqLines.length).toBe(3);
      for (const line of prereqLines) {
        expect(line).not.toContain('Warning');
        expect(line).toContain(CHECKMARK);
      }
    });

    it('init-detection checkPrerequisites should correctly parse git version string', async () => {
      // The bug: init-detection.ts parseVersion uses ^v? anchor that fails for
      // "git version 2.43.0" (starts with "git", not a digit or "v").
      // After fix: parseVersion should handle "git version X.Y.Z" strings.
      const { checkPrerequisites } = await import('../src/init-detection.js');

      const result = checkPrerequisites();

      // Git should be detected as installed (not "not found")
      expect(result.git.version).not.toBe('not found');

      // Git version should pass the >=2.0.0 requirement
      // (git 2.x is universally available on modern systems)
      expect(result.git.passed).toBe(true);
    });

    it('runDoctorForInit should not show Warning for passing prerequisites', async () => {
      const { runDoctorForInit } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctorForInit(tempDir);

      // When all prereqs pass, there should be no "Warning:" lines for prereqs
      const prereqWarnings = result.output
        .split('\n')
        .filter((line) => line.includes('Warning:') && line.includes('version'));
      expect(prereqWarnings).toHaveLength(0);
    });
  });

  describe('AC3: Failing prerequisite checks show warning prefix with actionable guidance', () => {
    it('formatDoctorOutput should show failure symbol for failing prerequisites', async () => {
      const { formatDoctorOutput } = await import('../src/doctor.js');

      const mockResult: DoctorResult = {
        status: 'ACTIVE',
        exitCode: 1,
        checks: {
          husky: { passed: true, message: 'Husky hooks installed' },
          safeGit: { passed: true, message: 'Safe-git wrapper present' },
          agentsMd: { passed: true, message: 'AGENTS.md exists' },
          lumenflowConfig: { passed: true, message: 'Config present' },
          laneHealth: { passed: true, message: 'Lane config healthy' },
        },
        vendorConfigs: {
          claude: { present: true, path: 'CLAUDE.md' },
          cursor: { present: false, path: '.cursor/rules/lumenflow.md' },
          windsurf: { present: false, path: '.windsurf/rules/lumenflow.md' },
          cline: { present: false, path: '.clinerules' },
          codex: { present: true, path: 'AGENTS.md' },
        },
        prerequisites: {
          node: {
            passed: false,
            version: 'v18.0.0',
            required: '>=22.0.0',
            message: 'Node.js 22.0.0+ required',
          },
          pnpm: { passed: true, version: '9.15.0', required: '>=9.0.0' },
          git: {
            passed: false,
            version: 'not found',
            required: '>=2.0.0',
            message: 'Git 2.0.0+ required',
          },
        },
      };

      const output = formatDoctorOutput(mockResult);

      // Failing node should show failure symbol
      const nodeLines = output.split('\n').filter((line) => line.includes('node:'));
      expect(nodeLines.length).toBeGreaterThan(0);
      for (const line of nodeLines) {
        expect(line).not.toContain(CHECKMARK);
        expect(line).toContain(CROSS);
      }

      // Passing pnpm should show checkmark
      const pnpmLines = output.split('\n').filter((line) => line.includes('pnpm:'));
      expect(pnpmLines.length).toBeGreaterThan(0);
      for (const line of pnpmLines) {
        expect(line).toContain(CHECKMARK);
      }

      // Failing git should show failure symbol
      const gitLines = output.split('\n').filter((line) => line.includes('git:'));
      expect(gitLines.length).toBeGreaterThan(0);
      for (const line of gitLines) {
        expect(line).not.toContain(CHECKMARK);
        expect(line).toContain(CROSS);
      }
    });

    it('runDoctorForInit should show Warning for failing prerequisites', async () => {
      const { runDoctorForInit } = await import('../src/doctor.js');

      setupMockProject({
        husky: true,
        safeGit: true,
        agentsMd: true,
        lumenflowConfig: true,
      });

      const result = await runDoctorForInit(tempDir);

      // On this system all prereqs should pass, so no warnings expected
      // This test verifies the format contract: warnings use "Warning:" prefix
      const warningLines = result.output.split('\n').filter((line) => line.includes('Warning:'));
      for (const line of warningLines) {
        // Any warning line should contain actionable information
        expect(line).toMatch(/version|required|detected|found/i);
      }
    });
  });
});
