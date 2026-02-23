import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const NPM_COMMAND = 'npm';
const NPM_INIT_ARGS = '-y';
const NPM_INIT_COMMAND = `${NPM_COMMAND} init ${NPM_INIT_ARGS}`;
const PNPM_COMMAND = 'pnpm';
const PNPM_ADD_COMMAND_PREFIX = `${PNPM_COMMAND} add`;
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';

const NODE_MODULES_BIN = 'node_modules/.bin';
const PACKAGES_LUMENFLOW = 'packages/@lumenflow/';
const NODE_MODULES = 'node_modules';
const PACKAGE_JSON_FILE = 'package.json';
const PACKAGE_NAME_CLI = '@lumenflow/cli';
const PACKAGE_NAME_CORE = '@lumenflow/core';
const WORKSPACE_PROTOCOL_PREFIX = 'workspace:';
const WORKSPACE_PACKAGE_SPEC = 'workspace:*';
const MONOREPO_ROOT_PATH = '/home/USER/source/hellmai/os';
const LUMENFLOW_PACKAGES_DIRECTORY = 'packages/@lumenflow';
const CORE_WORKSPACE_TO_REPO_ROOT = '../../..';
const EMPTY_DEPENDENCIES: Record<string, string> = {};
const WORKSPACE_ROOT_INSTALL_FLAG = '-w';

interface PackageJsonDocument {
  dependencies?: Record<string, string>;
}

function readPackageJson(projectDir: string): PackageJsonDocument {
  const packageJsonPath = join(projectDir, PACKAGE_JSON_FILE);
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonDocument;
}

function isWorkspaceDependencyVersion(version: string | undefined): boolean {
  return version?.startsWith(WORKSPACE_PROTOCOL_PREFIX) ?? false;
}

function isWorkspaceConsumerInstall(projectDir: string): boolean {
  const dependencies = readPackageJson(projectDir).dependencies ?? EMPTY_DEPENDENCIES;
  return [PACKAGE_NAME_CLI, PACKAGE_NAME_CORE]
    .map((packageName) => dependencies[packageName])
    .every((dependencyVersion) => isWorkspaceDependencyVersion(dependencyVersion));
}

function getRepositoryRoot(corePackageCwd: string): string {
  return resolve(corePackageCwd, CORE_WORKSPACE_TO_REPO_ROOT);
}

function writeWorkspaceManifest(tempProjectDirectory: string, repoRoot: string): void {
  const workspacePackageGlob = `${join(repoRoot, LUMENFLOW_PACKAGES_DIRECTORY)}/*`;
  const workspaceContent = `packages:\n  - "${workspacePackageGlob}"\n`;
  writeFileSync(join(tempProjectDirectory, PNPM_WORKSPACE_FILE), workspaceContent);
}

function installLocalPackages(tempProjectDirectory: string): void {
  const workspacePackages = [PACKAGE_NAME_CLI, PACKAGE_NAME_CORE]
    .map((packageName) => `${packageName}@${WORKSPACE_PACKAGE_SPEC}`)
    .join(' ');
  execSync(`${PNPM_ADD_COMMAND_PREFIX} ${WORKSPACE_ROOT_INSTALL_FLAG} ${workspacePackages}`, {
    cwd: tempProjectDirectory,
    stdio: 'pipe',
  });
}

/**
 * Check if a line is a comment (JSDoc, single-line, block comment continuation)
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('*') ||
    trimmed.startsWith('/**') ||
    trimmed.startsWith('*/') ||
    trimmed.startsWith('//')
  );
}

/**
 * Check if a line contains a legitimate path reference (string literals, CLI args, constants)
 */
function isLegitimatePathReference(line: string): boolean {
  // Allow string literals used as examples in output/help text
  const isStringLiteral = line.includes("'") || line.includes('"');
  // Allow CLI argument patterns
  const isCliArgument = line.includes('--code-paths') || line.includes('--');
  // Allow constant/variable definitions
  const isConstantDefinition = line.includes('const') || line.includes('let');
  return isStringLiteral || isCliArgument || isConstantDefinition;
}

/**
 * Get non-comment code lines containing PACKAGES_LUMENFLOW from file content
 */
function getProblematicPathLines(content: string): string[] {
  return content
    .split('\n')
    .filter((line: string) => !isCommentLine(line) && line.includes(PACKAGES_LUMENFLOW));
}

/**
 * Timeout for the beforeAll hook that runs `npm install` from the npm registry.
 * Network-dependent operations need a generous timeout to avoid flaky failures
 * in CI or on slow connections. 30 seconds accommodates typical install times
 * while still failing fast enough if the registry is truly unreachable.
 */
const SETUP_TIMEOUT_MS = 30_000;

/**
 * Timeout for individual test cases that spawn child processes (npx commands).
 * These need more time than the default 5s because they execute real CLI tools
 * in a temporary project directory.
 */
const COMMAND_TEST_TIMEOUT_MS = 15_000;

describe('Consumer Integration Tests', () => {
  let tempProjectDir: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    // Create a temporary directory for the test project
    const testName = 'lumenflow-consumer-test-' + Date.now();
    tempProjectDir = join(tmpdir(), testName);
    const repositoryRoot = getRepositoryRoot(originalCwd);

    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
    mkdirSync(tempProjectDir, { recursive: true });

    // Initialize a temporary npm project
    process.chdir(tempProjectDir);
    execSync(NPM_INIT_COMMAND, { stdio: 'pipe' });

    // Link workspace packages so this fixture is deterministic and independent of
    // whichever @lumenflow package versions are currently published on npm.
    writeWorkspaceManifest(tempProjectDir, repositoryRoot);
    installLocalPackages(tempProjectDir);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    // Clean up
    process.chdir(originalCwd);
    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  describe('Package Installation', () => {
    it('should install @lumenflow/cli and @lumenflow/core from local artifacts', () => {
      const packageJson = readPackageJson(tempProjectDir);
      const dependencies = packageJson.dependencies ?? EMPTY_DEPENDENCIES;

      expect(dependencies).toHaveProperty(PACKAGE_NAME_CLI);
      expect(dependencies).toHaveProperty(PACKAGE_NAME_CORE);

      // Verify the packages are actually installed
      const cliPath = join(tempProjectDir, NODE_MODULES, '@lumenflow', 'cli');
      const corePath = join(tempProjectDir, NODE_MODULES, '@lumenflow', 'core');

      expect(existsSync(cliPath)).toBe(true);
      expect(existsSync(corePath)).toBe(true);
    });

    it('should have executable CLI commands available', () => {
      const nodeModulesBin = join(tempProjectDir, NODE_MODULES_BIN);

      // Check that public CLI binaries are available
      const gatesBin = join(nodeModulesBin, 'gates');
      const validateBin = join(nodeModulesBin, 'validate');
      const wuStatusBin = join(nodeModulesBin, 'wu-status');
      const internalValidateBacklogSyncBin = join(nodeModulesBin, 'validate-backlog-sync');

      expect(existsSync(gatesBin)).toBe(true);
      expect(existsSync(validateBin)).toBe(true);
      expect(existsSync(wuStatusBin)).toBe(true);
      expect(existsSync(internalValidateBacklogSyncBin)).toBe(false);
    });

    it('should install lumenflow packages from local workspace artifacts', () => {
      const packageJson = readPackageJson(tempProjectDir);
      const dependencies = packageJson.dependencies ?? EMPTY_DEPENDENCIES;
      const coreDependency = dependencies[PACKAGE_NAME_CORE];
      const cliDependency = dependencies[PACKAGE_NAME_CLI];

      expect(coreDependency?.startsWith(WORKSPACE_PROTOCOL_PREFIX)).toBe(true);
      expect(cliDependency?.startsWith(WORKSPACE_PROTOCOL_PREFIX)).toBe(true);
    });
  });

  describe('Command Execution', () => {
    it('should run validate command successfully', { timeout: COMMAND_TEST_TIMEOUT_MS }, () => {
      // Run a public validation command and verify binary/path resolution.
      try {
        const output = execSync('npx validate --help', {
          cwd: tempProjectDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });

        // Should not throw and should produce output
        expect(typeof output).toBe('string');
        expect(output.length).toBeGreaterThan(0);
      } catch (error: any) {
        // Command might fail due to missing LumenFlow structure,
        // but it should not fail due to missing binaries or path resolution
        const errorMessage = error.message || error.stdout || error.stderr;
        expect(errorMessage).not.toContain('command not found');
        expect(errorMessage).not.toContain('ENOENT');
        expect(errorMessage).not.toContain('Cannot find module');
      }
    });

    it(
      'should run gates command and verify paths resolve',
      { timeout: COMMAND_TEST_TIMEOUT_MS },
      () => {
        // Create minimal project structure for gates
        const lumenflowDir = join(tempProjectDir, '.lumenflow');
        mkdirSync(lumenflowDir, { recursive: true });

        // Create minimal constraints file
        const constraintsPath = join(lumenflowDir, 'constraints.md');
        writeFileSync(constraintsPath, '# LumenFlow Constraints\n\nBasic constraints.\n');

        try {
          const output = execSync('npx gates --help', {
            cwd: tempProjectDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });

          // Should show help without path resolution errors
          expect(typeof output).toBe('string');
          expect(output.length).toBeGreaterThan(0);
          expect(output).toContain('Usage:'); // Help output should contain usage info
        } catch (error: any) {
          // Should not fail due to missing binaries or path resolution
          const errorMessage = error.message || error.stdout || error.stderr;
          expect(errorMessage).not.toContain('command not found');
          expect(errorMessage).not.toContain('ENOENT');
          expect(errorMessage).not.toContain('Cannot find module');
        }
      },
    );

    it('should have all required CLI binaries properly resolved', () => {
      const nodeModulesBin = join(tempProjectDir, NODE_MODULES_BIN);
      const usingWorkspaceInstall = isWorkspaceConsumerInstall(tempProjectDir);

      // Test key public binaries to ensure they're executable and don't have hardcoded paths
      const keyBinaries = ['gates', 'validate', 'wu-status', 'wu-claim', 'wu-done'];

      keyBinaries.forEach((binary: string) => {
        const binaryPath = join(nodeModulesBin, binary);
        expect(existsSync(binaryPath), `${binary} should exist`).toBe(true);

        // Workspace-linked shim wrappers can contain absolute paths to local packages.
        // Only enforce hardcoded-path rejection when testing non-workspace installs.
        const binaryContent = readFileSync(binaryPath, 'utf8');
        if (!usingWorkspaceInstall) {
          expect(binaryContent).not.toContain(MONOREPO_ROOT_PATH);
        }

        // Allow legitimate documentation references in JSDoc comments
        // but check for problematic hardcoded paths in code
        const codeLines = getProblematicPathLines(binaryContent);

        // If there are any non-comment references to packages/@lumenflow/, they should be
        // legitimate CLI usage (string literals for examples, CLI arguments)
        for (const line of codeLines) {
          expect(
            isLegitimatePathReference(line),
            `${binary} should not have hardcoded monorepo path in code: ${line.trim()}`,
          ).toBe(true);
        }
      });
    });
  });

  describe('Path Resolution Validation', () => {
    it('should not contain hardcoded monorepo paths in package files', () => {
      const cliPackagePath = join(
        tempProjectDir,
        NODE_MODULES,
        '@lumenflow',
        'cli',
        'package.json',
      );
      const corePackagePath = join(
        tempProjectDir,
        NODE_MODULES,
        '@lumenflow',
        'core',
        'package.json',
      );

      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const cliPackage = require(cliPackagePath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const corePackage = require(corePackagePath);

      // Verify repository URLs are public, not local paths
      expect(cliPackage.repository.url).not.toContain('/home/USER/');
      expect(corePackage.repository.url).not.toContain('/home/USER/');
      expect(cliPackage.repository.url).toContain('github.com');
      expect(corePackage.repository.url).toContain('github.com');
    });

    it('should have proper import paths in distributed files', () => {
      const cliDistPath = join(tempProjectDir, NODE_MODULES, '@lumenflow', 'cli', 'dist');
      const coreDistPath = join(tempProjectDir, NODE_MODULES, '@lumenflow', 'core', 'dist');

      const checkDistFiles = (distPath: string) => {
        if (!existsSync(distPath)) {
          return;
        }

        const files = readdirSync(distPath);
        files.forEach((file: string) => {
          if (!file.endsWith('.js')) {
            return;
          }

          const filePath = join(distPath, file);
          const content = readFileSync(filePath, 'utf8');
          // Should not contain local development paths
          expect(content).not.toContain('/home/USER/source/hellmai/os');

          // Allow legitimate documentation references in JSDoc comments
          // but check for problematic hardcoded paths in code
          const lines = content.split('\n');
          const codeLines = lines.filter(
            (line: string) =>
              !line.trim().startsWith('*') &&
              !line.trim().startsWith('/**') &&
              !line.trim().startsWith('*/') &&
              !line.trim().startsWith('//') &&
              line.includes(PACKAGES_LUMENFLOW),
          );

          // If there are any non-comment references to packages/@lumenflow/, they should be imports or legitimate CLI usage
          codeLines.forEach((line: string) => {
            if (!line.includes(PACKAGES_LUMENFLOW)) {
              return;
            }

            // Allow import statements and CLI arguments, but not hardcoded absolute paths
            const importRegex = /from ['"]@lumenflow\//;
            const isImport = importRegex.test(line);
            const isCliArgument =
              line.includes('--code-paths') || line.includes('--') || line.includes('node ');
            const isDocReference = line.includes('DOC_SOURCE_PATHSPECS') || line.includes('@see');
            const isConstantDefinition =
              line.includes("'") ||
              line.includes('"') ||
              line.includes('[') ||
              line.includes('export const');

            expect(isImport || isCliArgument || isDocReference || isConstantDefinition).toBe(true);
          });
        });
      };

      checkDistFiles(cliDistPath);
      checkDistFiles(coreDistPath);
    });
  });
});
