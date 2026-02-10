/**
 * @file init-scripts.test.ts
 * Test: Generated package.json scripts use correct format (wu-create, wu-claim, wu-done, gates)
 *
 * WU-1307: Fix lumenflow-init scaffolding
 *
 * The init command should inject standalone binary scripts that work
 * in consumer projects without requiring the full @lumenflow/cli path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scaffoldProject } from '../init.js';
import { getPublicManifest } from '../public-manifest.js';

/** Package.json file name - extracted to avoid duplicate string lint errors */
const PACKAGE_JSON_FILE_NAME = 'package.json';

/** Type for package.json scripts */
interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
}

describe('init scripts generation (WU-1307)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-scripts-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse package.json from temp directory */
  function readPackageJson(): PackageJson {
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  }

  it('should generate package.json scripts using standalone binaries', async () => {
    // Arrange
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const packageJson = readPackageJson();
    expect(packageJson.scripts).toBeDefined();

    // Scripts should use standalone binary format (wu-create, wu-claim, etc.)
    // NOT 'pnpm exec lumenflow' format
    expect(packageJson.scripts?.['wu:claim']).toBe('wu-claim');
    expect(packageJson.scripts?.['wu:done']).toBe('wu-done');
    expect(packageJson.scripts?.['wu:create']).toBe('wu-create');
    expect(packageJson.scripts?.gates).toBe('gates');
  });

  it('should NOT use pnpm exec lumenflow format', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Ensure scripts do NOT use the old 'pnpm exec lumenflow' format
    const scriptValues = Object.values(packageJson.scripts ?? {});
    const hasOldFormat = scriptValues.some((script) => script.includes('pnpm exec lumenflow'));
    expect(hasOldFormat).toBe(false);
  });

  it('should include all essential WU lifecycle scripts', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Essential scripts that must be present
    const essentialScripts = ['wu:claim', 'wu:done', 'wu:create', 'wu:status', 'gates'];
    for (const scriptName of essentialScripts) {
      expect(packageJson.scripts?.[scriptName]).toBeDefined();
    }
  });

  it('should preserve existing scripts when updating package.json', async () => {
    // Arrange
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const existingPackageJson = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'vitest',
        build: 'tsc',
        custom: 'echo hello',
      },
    };
    fs.writeFileSync(packageJsonPath, JSON.stringify(existingPackageJson, null, 2));

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Existing scripts should be preserved
    expect(packageJson.scripts?.test).toBe('vitest');
    expect(packageJson.scripts?.build).toBe('tsc');
    expect(packageJson.scripts?.custom).toBe('echo hello');

    // LumenFlow scripts should be added
    expect(packageJson.scripts?.['wu:claim']).toBeDefined();
    expect(packageJson.scripts?.gates).toBeDefined();
  });

  // WU-1342: Test for all 17 essential commands
  it('should include all 17 essential commands (WU-1342)', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();

    // All 17 essential commands that must be present per WU-1342 acceptance criteria
    const essentialScripts = [
      // Core WU lifecycle
      'wu:claim',
      'wu:done',
      'wu:create',
      'wu:status',
      'wu:block',
      'wu:unblock',
      // Additional critical commands (WU-1342)
      'wu:prep',
      'wu:recover',
      'wu:spawn',
      'wu:validate',
      'wu:infer-lane',
      // Memory commands
      'mem:init',
      'mem:checkpoint',
      'mem:inbox',
      // Lane commands
      'lane:suggest',
      // Gates
      'gates',
      'gates:docs',
    ];

    for (const scriptName of essentialScripts) {
      expect(
        packageJson.scripts?.[scriptName],
        `Missing essential script: ${scriptName}`,
      ).toBeDefined();
    }

    // Verify count
    const lumenflowScripts = Object.keys(packageJson.scripts ?? {}).filter(
      (key) =>
        key.startsWith('wu:') ||
        key.startsWith('mem:') ||
        key.startsWith('lane:') ||
        key === 'gates' ||
        key === 'gates:docs',
    );
    expect(lumenflowScripts.length).toBeGreaterThanOrEqual(17);
  });
});

describe('init .gitignore generation (WU-1342)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-gitignore-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create .gitignore with required exclusions (WU-1342)', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const gitignorePath = path.join(tempDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');

    // Must include node_modules
    expect(content).toContain('node_modules');

    // Must include .lumenflow/telemetry
    expect(content).toContain('.lumenflow/telemetry');

    // Must include worktrees
    expect(content).toContain('worktrees');
  });

  it('should preserve existing .gitignore content in merge mode (WU-1342)', async () => {
    // Arrange
    const gitignorePath = path.join(tempDir, '.gitignore');
    const existingContent = '# Custom ignores\n.env\n*.log\n';
    fs.writeFileSync(gitignorePath, existingContent);

    // Act
    await scaffoldProject(tempDir, { force: false, full: true, merge: true });

    // Assert
    const content = fs.readFileSync(gitignorePath, 'utf-8');

    // Should preserve existing content
    expect(content).toContain('.env');
    expect(content).toContain('*.log');

    // Should add LumenFlow exclusions
    expect(content).toContain('node_modules');
    expect(content).toContain('.lumenflow/telemetry');
    expect(content).toContain('worktrees');
  });
});

describe('init .claude directory creation (WU-1342)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-claude-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create .claude directory when --client claude specified (WU-1342)', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: false, client: 'claude' });

    // Assert
    const claudeDir = path.join(tempDir, '.claude');
    expect(fs.existsSync(claudeDir)).toBe(true);

    // Should have agents directory
    const agentsDir = path.join(claudeDir, 'agents');
    expect(fs.existsSync(agentsDir)).toBe(true);

    // Should have settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    // Should have skills directory
    const skillsDir = path.join(claudeDir, 'skills');
    expect(fs.existsSync(skillsDir)).toBe(true);
  });
});

// ============================================================================
// WU-1518: Gate stub scripts scaffolded by lumenflow init
// ============================================================================
describe('init gate stub scripts (WU-1518)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-gate-stubs-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function readPackageJsonScripts(): Record<string, string> {
    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageJson;
    return pkg.scripts ?? {};
  }

  it('should add spec:linter stub script', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['spec:linter'], 'Missing spec:linter script').toBeDefined();
  });

  it('should add lint stub script', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['lint'], 'Missing lint script').toBeDefined();
  });

  it('should add typecheck stub script', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['typecheck'], 'Missing typecheck script').toBeDefined();
  });

  it('should use stub commands that log a clear enablement message', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    // Each stub should contain an echo with guidance text
    for (const scriptName of ['spec:linter', 'lint', 'typecheck']) {
      const value = scripts[scriptName];
      expect(value, `${scriptName} should be defined`).toBeDefined();
      // Stub scripts should include a message about enabling (echo + exit 0 pattern)
      expect(value, `${scriptName} stub should log a message`).toContain('echo');
    }
  });

  it('should not overwrite existing lint/typecheck scripts', async () => {
    // Arrange: pre-existing real scripts
    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const existingPkg = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        'spec:linter': 'node tools/spec-linter.js',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2));

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert: existing scripts preserved
    const scripts = readPackageJsonScripts();
    expect(scripts['lint']).toBe('eslint .');
    expect(scripts['typecheck']).toBe('tsc --noEmit');
    expect(scripts['spec:linter']).toBe('node tools/spec-linter.js');
  });

  it('should overwrite stub scripts when --force is used', async () => {
    // Arrange: pre-existing scripts
    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const existingPkg = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        lint: 'old-lint-command',
        typecheck: 'old-typecheck-command',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2));

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert: scripts should be overwritten with stubs
    const scripts = readPackageJsonScripts();
    expect(scripts['lint']).not.toBe('old-lint-command');
    expect(scripts['typecheck']).not.toBe('old-typecheck-command');
  });
});

// ============================================================================
// WU-1433: Scripts generated from public CLI manifest
// ============================================================================
describe('init scripts from public manifest (WU-1433)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-manifest-scripts-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function readPackageJsonScripts(): Record<string, string> {
    const pkgPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageJson;
    return pkg.scripts ?? {};
  }

  it('should generate a script for every public manifest command', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();
    const manifest = getPublicManifest();

    for (const cmd of manifest) {
      expect(scripts[cmd.name], `Missing script for manifest command: ${cmd.name}`).toBeDefined();
    }
  });

  it('should map script values to the binary names from the manifest', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();
    const manifest = getPublicManifest();

    for (const cmd of manifest) {
      const scriptValue = scripts[cmd.name];
      expect(scriptValue).toBeDefined();
      // Script value should contain the binName (may also have args like --docs-only)
      expect(
        scriptValue,
        `Script "${cmd.name}" should reference binary "${cmd.binName}"`,
      ).toContain(cmd.binName);
    }
  });

  it('should include required alias: docs:sync', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['docs:sync']).toBeDefined();
    expect(scripts['docs:sync']).toContain('lumenflow-docs-sync');
  });

  it('should include required alias: sync:templates', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['sync:templates']).toBeDefined();
    expect(scripts['sync:templates']).toContain('sync-templates');
  });

  it('should include required alias: gates:docs with --docs-only', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();

    expect(scripts['gates:docs']).toBeDefined();
    expect(scripts['gates:docs']).toContain('--docs-only');
  });

  it('should have at least as many scripts as public manifest commands', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });
    const scripts = readPackageJsonScripts();
    const manifest = getPublicManifest();

    const manifestNames = new Set(manifest.map((cmd) => cmd.name));
    const scriptNames = new Set(Object.keys(scripts));

    for (const name of manifestNames) {
      expect(scriptNames.has(name), `Script missing for: ${name}`).toBe(true);
    }
  });
});
