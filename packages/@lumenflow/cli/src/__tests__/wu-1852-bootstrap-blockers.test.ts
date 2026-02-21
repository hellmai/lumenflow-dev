// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-1852-bootstrap-blockers.test.ts
 * WU-1852: Fix first-project bootstrap blockers in lumenflow init
 *
 * Tests for 5 acceptance criteria:
 * AC1: cos:gates no-op stub scaffolded in package.json
 * AC2: wu:done error message does not reference --skip-cos-gates
 * AC3: .logs/ in .gitignore template
 * AC4: lumenflow init output displays Parent: Sublane naming requirement
 * AC5: wu:create reports all validation errors at once (pre-existing, tested separately)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// AC1 and AC3: Template-level tests
import { GATE_STUB_SCRIPTS, GITIGNORE_TEMPLATE } from '../init-templates.js';

// AC1: Integration test via scaffoldProject
import { scaffoldProject } from '../init.js';

/** Package.json file name constant */
const PACKAGE_JSON_FILE = 'package.json';

/** Constant for cos:gates script name */
const COS_GATES_SCRIPT = 'cos:gates';
const WORKSPACE_FILE = 'workspace.yaml';
const PACK_ID_SOFTWARE_DELIVERY = 'software-delivery';
const BOOTSTRAP_DOMAIN_INFRA = 'infra';
const BOOTSTRAP_DOMAIN_CUSTOM = 'custom';

/** Type for package.json structure */
interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
}

// ============================================================================
// AC1: cos:gates no-op stub scaffolded in package.json
// ============================================================================
describe('AC1: cos:gates no-op stub in GATE_STUB_SCRIPTS (WU-1852)', () => {
  it('GATE_STUB_SCRIPTS includes cos:gates entry', () => {
    expect(GATE_STUB_SCRIPTS[COS_GATES_SCRIPT]).toBeDefined();
  });

  it('cos:gates stub exits 0 (no-op)', () => {
    const stub = GATE_STUB_SCRIPTS[COS_GATES_SCRIPT];
    // The stub should exit 0 (contain exit 0 or just echo/log and return)
    expect(stub).toContain('exit 0');
  });

  it('cos:gates stub includes lumenflow echo prefix like other stubs', () => {
    const stub = GATE_STUB_SCRIPTS[COS_GATES_SCRIPT];
    expect(stub).toContain('[lumenflow]');
  });
});

describe('AC1: scaffoldProject injects cos:gates stub (WU-1852)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-cos-gates-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('scaffoldProject adds cos:gates script to package.json', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;

    expect(pkg.scripts?.[COS_GATES_SCRIPT]).toBeDefined();
  });

  it('cos:gates stub is a no-op that exits 0', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;

    const script = pkg.scripts?.[COS_GATES_SCRIPT];
    expect(script).toBeDefined();
    expect(script).toContain('exit 0');
  });

  it('does not overwrite existing cos:gates script', async () => {
    // Pre-populate with a real cos:gates script
    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE);
    const existingPkg = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        'cos:gates': 'node tools/cos-gates.js',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2));

    await scaffoldProject(tempDir, { force: false, full: true });

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;
    expect(pkg.scripts?.[COS_GATES_SCRIPT]).toBe('node tools/cos-gates.js');
  });
});

// ============================================================================
// AC2: wu:done error message does not reference --skip-cos-gates
// ============================================================================
describe('AC2: wu:done error message does not reference --skip-cos-gates (WU-1852)', () => {
  it('COS gates failure error message does not suggest --skip-cos-gates flag', async () => {
    // Read the wu-done.ts source and check that console.error output lines
    // do not reference the non-existent --skip-cos-gates flag.
    // Code comments explaining the fix are acceptable.
    const wuDoneSrc = fs.readFileSync(path.join(__dirname, '..', 'wu-done.ts'), 'utf-8');

    // Extract all console.error lines (user-facing output)
    const consoleErrorLines = wuDoneSrc
      .split('\n')
      .filter((line) => line.includes('console.error'));

    // No console.error line should suggest --skip-cos-gates
    for (const line of consoleErrorLines) {
      expect(line).not.toContain('--skip-cos-gates');
    }
  });

  it('COS gates failure suggests --skip-gates (the real flag) instead', async () => {
    const wuDoneSrc = fs.readFileSync(path.join(__dirname, '..', 'wu-done.ts'), 'utf-8');

    // The COS gates error section should reference --skip-gates in its console.error output.
    // The string may span multiple source lines (template literal), so check a window
    // around the "COS governance gates failed" message.
    const lines = wuDoneSrc.split('\n');
    const cosFailureIdx = lines.findIndex((l) => l.includes('COS governance gates failed'));
    expect(cosFailureIdx).toBeGreaterThan(-1);

    // Check the next 15 lines after the failure message for --skip-gates reference
    const cosSection = lines.slice(cosFailureIdx, cosFailureIdx + 15).join('\n');
    expect(cosSection).toContain('--skip-gates');
  });
});

// ============================================================================
// AC3: .logs/ present in .gitignore template
// ============================================================================
describe('AC3: .logs/ in .gitignore template (WU-1852)', () => {
  it('GITIGNORE_TEMPLATE contains .logs/ entry', () => {
    expect(GITIGNORE_TEMPLATE).toContain('.logs/');
  });
});

describe('AC3: scaffoldProject includes .logs/ in .gitignore (WU-1852)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-logs-gitignore-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('.gitignore created by scaffoldProject contains .logs/', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const gitignorePath = path.join(tempDir, '.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf-8');

    expect(content).toContain('.logs/');
  });
});

// ============================================================================
// AC4: lumenflow init output displays Parent: Sublane naming requirement
// ============================================================================
describe('AC4: init output displays lane naming format (WU-1852)', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof import('vitest').vi.spyOn>;

  beforeEach(async () => {
    const { vi } = await import('vitest');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-lane-format-'));
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  afterEach(async () => {
    const { vi } = await import('vitest');
    consoleLogSpy.mockRestore();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('scaffoldProject output mentions Parent: Sublane format', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const allLogs = consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    // Should mention the Parent: Sublane format requirement
    expect(allLogs).toContain('Parent: Sublane');
  });

  it('scaffoldProject output lists valid parent lane names', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const allLogs = consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    // Should list at least some of the valid parent names from DEFAULT_LANE_DEFINITIONS
    // e.g. Framework, Experience, Operations, Content
    expect(allLogs).toMatch(/Framework|Experience|Operations|Content/);
  });
});

// ============================================================================
// AC5: wu:create reports all validation errors at once
// ============================================================================
describe('AC5: wu:create reports all validation errors at once (WU-1852)', () => {
  // This is already tested in wu-create-validation-aggregate.test.ts (WU-1302)
  // Including a basic check here for completeness
  it('validateCreateSpec returns multiple errors when multiple fields missing', async () => {
    const { validateCreateSpec } = await import('../wu-create-validation.js');

    const result = validateCreateSpec({
      id: 'WU-9999',
      lane: 'Framework: CLI',
      title: 'Test WU',
      priority: 'P2',
      type: 'feature',
      opts: {},
    });

    expect(result.valid).toBe(false);
    // Should have at least 4 errors: description, acceptance, exposure, code-paths, spec-refs
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================================
// WU-1978: bootstrap-all default path
// ============================================================================
describe('WU-1978: bootstrap-all default path', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-bootstrap-all-'));
  });

  afterEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.unmock('../onboard.js');
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function importInitWithMockedOnboard(
    runOnboardImpl: (args: unknown) => Promise<unknown>,
  ): Promise<typeof import('../init.js')> {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('../onboard.js', () => ({
      runOnboard: runOnboardImpl,
    }));
    return import('../init.js');
  }

  it('parseInitOptions accepts bootstrap flags for CI/agent non-interactive flow', async () => {
    const { parseInitOptions } = await importInitWithMockedOnboard(async () => ({
      success: true,
      errors: [],
      workspaceGenerated: true,
      packInstalled: true,
    }));
    const originalArgv = process.argv;

    process.argv = [
      'node',
      'init',
      '--bootstrap-domain',
      BOOTSTRAP_DOMAIN_INFRA,
      '--skip-bootstrap',
      '--skip-bootstrap-pack-install',
    ];

    try {
      const parsed = parseInitOptions();
      expect(parsed.bootstrapDomain).toBe(BOOTSTRAP_DOMAIN_INFRA);
      expect(parsed.skipBootstrap).toBe(true);
      expect(parsed.skipBootstrapPackInstall).toBe(true);
    } finally {
      process.argv = originalArgv;
    }
  });

  it('runInitBootstrap invokes onboard non-interactively for fresh directories', async () => {
    const calls: unknown[] = [];
    const { runInitBootstrap } = await importInitWithMockedOnboard(async (args) => {
      calls.push(args);
      return {
        success: true,
        errors: [],
        workspaceGenerated: true,
        packInstalled: true,
      };
    });

    const result = await runInitBootstrap({
      targetDir: tempDir,
      force: false,
      bootstrapDomain: PACK_ID_SOFTWARE_DELIVERY,
      skipBootstrap: false,
      skipBootstrapPackInstall: false,
    });

    expect(result.skipped).toBe(false);
    expect(result.workspaceGenerated).toBe(true);
    expect(result.packInstalled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      nonInteractive: true,
      targetDir: tempDir,
      skipDashboard: true,
      skipPackInstall: false,
      domain: PACK_ID_SOFTWARE_DELIVERY,
    });
  });

  it('runInitBootstrap skips when workspace.yaml already exists and force=false', async () => {
    const { runInitBootstrap } = await importInitWithMockedOnboard(async () => ({
      success: true,
      errors: [],
      workspaceGenerated: true,
      packInstalled: true,
    }));
    fs.writeFileSync(path.join(tempDir, WORKSPACE_FILE), 'id: existing\n', 'utf-8');

    const result = await runInitBootstrap({
      targetDir: tempDir,
      force: false,
      bootstrapDomain: PACK_ID_SOFTWARE_DELIVERY,
      skipBootstrap: false,
      skipBootstrapPackInstall: true,
    });

    expect(result.skipped).toBe(true);
  });

  it('runInitBootstrap rejects when required pack installation is missing integrity-backed pin', async () => {
    const { runInitBootstrap } = await importInitWithMockedOnboard(async () => ({
      success: true,
      errors: [],
      workspaceGenerated: true,
      packInstalled: false,
    }));

    await expect(
      runInitBootstrap({
        targetDir: tempDir,
        force: false,
        bootstrapDomain: PACK_ID_SOFTWARE_DELIVERY,
        skipBootstrap: false,
        skipBootstrapPackInstall: false,
      }),
    ).rejects.toThrow(/integrity metadata/i);
  });

  it('runInitBootstrap allows custom domain without pack installation', async () => {
    const { runInitBootstrap } = await importInitWithMockedOnboard(async () => ({
      success: true,
      errors: [],
      workspaceGenerated: true,
      packInstalled: false,
    }));

    const result = await runInitBootstrap({
      targetDir: tempDir,
      force: false,
      bootstrapDomain: BOOTSTRAP_DOMAIN_CUSTOM,
      skipBootstrap: false,
      skipBootstrapPackInstall: false,
    });

    expect(result.skipped).toBe(false);
    expect(result.packInstalled).toBe(false);
  });

  it('runInitBootstrap bypasses bootstrap flow when --skip-bootstrap is set', async () => {
    const { runInitBootstrap } = await importInitWithMockedOnboard(async () => ({
      success: true,
      errors: [],
      workspaceGenerated: true,
      packInstalled: true,
    }));

    const result = await runInitBootstrap({
      targetDir: tempDir,
      force: false,
      bootstrapDomain: PACK_ID_SOFTWARE_DELIVERY,
      skipBootstrap: true,
      skipBootstrapPackInstall: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('--skip-bootstrap');
  });
});
