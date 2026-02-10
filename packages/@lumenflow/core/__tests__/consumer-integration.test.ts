import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const NODE_MODULES_BIN = 'node_modules/.bin';
const PACKAGES_LUMENFLOW = 'packages/@lumenflow/';
const NODE_MODULES = 'node_modules';

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

    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
    mkdirSync(tempProjectDir, { recursive: true });

    // Initialize a temporary npm project
    process.chdir(tempProjectDir);
    execSync('npm init -y', { stdio: 'pipe' });

    // Install packages from npm registry (not local workspace)
    execSync('npm install @lumenflow/cli @lumenflow/core', {
      stdio: 'pipe',
      env: {
        ...process.env,
        // Force npm to use registry instead of workspace
        npm_config_workspaces: 'false',
      },
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    // Clean up
    process.chdir(originalCwd);
    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  describe('Package Installation', () => {
    it('should install @lumenflow/cli from npm registry', () => {
      const packageJsonPath = join(tempProjectDir, 'package.json');
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const packageJson = require(packageJsonPath);

      expect(packageJson.dependencies).toHaveProperty('@lumenflow/cli');
      expect(packageJson.dependencies).toHaveProperty('@lumenflow/core');

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

      // Test key public binaries to ensure they're executable and don't have hardcoded paths
      const keyBinaries = ['gates', 'validate', 'wu-status', 'wu-claim', 'wu-done'];

      keyBinaries.forEach((binary: string) => {
        const binaryPath = join(nodeModulesBin, binary);
        expect(existsSync(binaryPath), `${binary} should exist`).toBe(true);

        // Check that binary is not using hardcoded monorepo paths
        const binaryContent = readFileSync(binaryPath, 'utf8');
        expect(binaryContent).not.toContain('/home/tom/source/hellmai/os');

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
      expect(cliPackage.repository.url).not.toContain('/home/tom/');
      expect(corePackage.repository.url).not.toContain('/home/tom/');
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
          expect(content).not.toContain('/home/tom/source/hellmai/os');

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
