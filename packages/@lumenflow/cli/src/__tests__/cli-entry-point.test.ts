/**
 * Tests for CLI entry point error handling
 *
 * Verifies that runCLI wrapper properly:
 * - Catches async errors from main()
 * - Logs error messages to stderr
 * - Exits with EXIT_CODES.ERROR on failure
 *
 * WU-1071: Also verifies that CLI entry points use import.meta.main pattern
 * instead of the broken process.argv[1] === fileURLToPath(import.meta.url) pattern.
 *
 * WU-1537: Verifies ALL CLI entry points use runCLI(main) wrapper instead of
 * inline main().catch() patterns, ensuring consistent EPIPE and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { runCLI } from '../cli-entry-point.js';
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import { ProcessExitError } from '@lumenflow/core';

describe('runCLI', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should call main() and do nothing on success', async () => {
    const main = vi.fn().mockResolvedValue(undefined);

    await runCLI(main);

    expect(main).toHaveBeenCalledOnce();
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it('should catch errors and exit with ERROR code', async () => {
    const error = new Error('Test error message');
    const main = vi.fn().mockRejectedValue(error);

    await runCLI(main);

    expect(main).toHaveBeenCalledOnce();
    expect(mockConsoleError).toHaveBeenCalledWith('Test error message');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should handle errors without message property', async () => {
    const main = vi.fn().mockRejectedValue('string error');

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenCalledWith('string error');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should handle null/undefined errors', async () => {
    const main = vi.fn().mockRejectedValue(null);

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenCalledWith('Unknown error');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should print --help hint for unknown option errors', async () => {
    const error = Object.assign(new Error("unknown option '--bogus'"), {
      code: 'commander.unknownOption',
    });
    const main = vi.fn().mockRejectedValue(error);

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenNthCalledWith(1, "unknown option '--bogus'");
    expect(mockConsoleError).toHaveBeenNthCalledWith(
      2,
      'Hint: Run with --help to see valid options.',
    );
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should print --help hint for missing required option errors', async () => {
    const error = Object.assign(new Error("required option '--id <wuId>' not specified"), {
      code: 'VALIDATION_ERROR',
      details: { code: 'commander.missingMandatoryOptionValue' },
    });
    const main = vi.fn().mockRejectedValue(error);

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenNthCalledWith(
      1,
      "required option '--id <wuId>' not specified",
    );
    expect(mockConsoleError).toHaveBeenNthCalledWith(
      2,
      'Hint: Run with --help to see valid options.',
    );
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

/**
 * WU-1538: runCLI catches ProcessExitError and maps to process.exit
 */
describe('runCLI ProcessExitError handling (WU-1538)', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should catch ProcessExitError and exit with its exitCode', async () => {
    const main = async () => {
      throw new ProcessExitError('Gates failed', 2);
    };

    await runCLI(main);

    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('should catch ProcessExitError with exit code 0 (help display)', async () => {
    const main = async () => {
      throw new ProcessExitError('Help displayed', 0);
    };

    await runCLI(main);

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('should not double-log ProcessExitError messages (die already logged)', async () => {
    const main = async () => {
      throw new ProcessExitError('[wu-done] Something failed', 1);
    };

    await runCLI(main);

    // ProcessExitError was already logged by die(), so runCLI should not log it again
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it('should still log generic Error messages', async () => {
    const main = async () => {
      throw new Error('Unexpected failure');
    };

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenCalledWith('Unexpected failure');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

/**
 * WU-1071/WU-1181: Verify CLI entry points use import.meta.main pattern
 *
 * The old pattern `process.argv[1] === fileURLToPath(import.meta.url)` fails with
 * pnpm symlinks because process.argv[1] is the symlink path but import.meta.url
 * resolves to the real path - they never match so main() is never called.
 *
 * The fix is to use `import.meta.main` (Node.js 22.16.0+ built-in) which correctly
 * handles symlinks.
 *
 * WU-1181: Extended to validate ALL CLI files with entry guards, not just a subset.
 *
 * WU-1537: Extended to validate ALL CLI entry points use runCLI(main) wrapper
 * instead of inline main().catch() patterns, ensuring consistent EPIPE handling
 * and error lifecycle behavior across all commands.
 */
describe('WU-1071/WU-1181: CLI entry point patterns', () => {
  // Files that should NOT be checked for entry guards
  // (helper modules, index files, tests, or files without CLI entry points)
  const EXCLUDED_FILES = new Set([
    'cli-entry-point.ts', // Helper module, not a CLI entry point itself
    'index.ts', // Re-exports only
    'merge-block.ts', // Not a CLI entry point (no main guard needed)
    'wu-done-check.ts', // Not a CLI entry point (no main guard needed)
    'wu-spawn-completion.ts', // Not a CLI entry point (helper module)
    'agent-session.ts', // Not a CLI entry point (helper module)
    'agent-session-end.ts', // Not a CLI entry point (helper module)
    'agent-log-issue.ts', // Not a CLI entry point (helper module)
    'orchestrate-init-status.ts', // Not a CLI entry point (helper module)
    'orchestrate-initiative.ts', // Not a CLI entry point (helper module)
    'orchestrate-monitor.ts', // Not a CLI entry point (helper module)
  ]);

  // Old broken pattern that fails with pnpm symlinks
  const OLD_BROKEN_PATTERN =
    /if\s*\(\s*process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)\s*\)/;

  // Legacy import.meta.url entrypoint pattern (WU-1537)
  const LEGACY_IMPORT_META_URL_PATTERN =
    /if\s*\(\s*import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`\s*\)/;

  // New working pattern using import.meta.main
  const NEW_WORKING_PATTERN = /if\s*\(\s*import\.meta\.main\s*\)/;

  // Inline main().catch() pattern that should be replaced by runCLI(main) (WU-1537)
  const MAIN_CATCH_PATTERN = /main\(\)\.catch\(/;

  // Correct runCLI(main) pattern (WU-1537)
  const RUN_CLI_PATTERN = /runCLI\(main\)/;

  /**
   * Discovers all CLI files with entry points by scanning the src directory
   * and subdirectories. A CLI entry point file has an exported main() function
   * and either an entry guard or a top-level main() invocation.
   *
   * WU-1537: Now scans subdirectories (e.g., commands/) to catch all entry points.
   */
  function discoverCLIFilesWithEntryPoints(): string[] {
    const srcDir = path.resolve(__dirname, '..');
    const results: string[] = [];

    function scanDir(dir: string, prefix: string): void {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry === '__tests__' || entry === 'hooks') continue;
        const fullPath = path.join(dir, entry);
        const relativeName = prefix ? `${prefix}/${entry}` : entry;

        if (statSync(fullPath).isDirectory()) {
          scanDir(fullPath, relativeName);
          continue;
        }

        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        if (EXCLUDED_FILES.has(entry)) continue;

        const content = readFileSync(fullPath, 'utf-8');
        const hasEntryGuard =
          OLD_BROKEN_PATTERN.test(content) ||
          NEW_WORKING_PATTERN.test(content) ||
          LEGACY_IMPORT_META_URL_PATTERN.test(content);
        const hasTopLevelMainCall = MAIN_CATCH_PATTERN.test(content);
        const hasRunCLI = RUN_CLI_PATTERN.test(content);

        if (hasEntryGuard || hasTopLevelMainCall || hasRunCLI) {
          results.push(relativeName);
        }
      }
    }

    scanDir(srcDir, '');
    return results;
  }

  it('should discover all CLI files with entry points', () => {
    const cliFiles = discoverCLIFilesWithEntryPoints();

    // WU-1181: There should be a significant number of CLI files with entry guards
    // This test ensures we're actually discovering files, not returning an empty list
    // WU-1537: Updated to include files that were previously excluded but have entry points
    expect(cliFiles.length).toBeGreaterThan(40);
  });

  it('should use import.meta.main instead of process.argv[1] comparison in ALL CLI files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryPoints();

    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Should NOT have old broken pattern
      if (OLD_BROKEN_PATTERN.test(content)) {
        errors.push(`${file} uses the old broken pattern (process.argv[1] === fileURLToPath)`);
      }

      // Should NOT have legacy import.meta.url pattern (WU-1537)
      if (LEGACY_IMPORT_META_URL_PATTERN.test(content)) {
        errors.push(`${file} uses the legacy import.meta.url entrypoint pattern`);
      }

      // Should have new working pattern
      if (!NEW_WORKING_PATTERN.test(content)) {
        errors.push(`${file} does not use import.meta.main pattern`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`Entry point pattern violations:\n${errors.join('\n')}`);
    }
  });

  /**
   * WU-1537: Verify all CLI entry points use runCLI(main) wrapper.
   *
   * The inline main().catch() pattern lacks EPIPE handling and produces
   * inconsistent error lifecycle behavior. All entry points must use
   * runCLI(main) from cli-entry-point.ts for consistent behavior.
   */
  it('should use runCLI(main) instead of main().catch() in ALL CLI entry points', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryPoints();

    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Should NOT have inline main().catch() pattern
      if (MAIN_CATCH_PATTERN.test(content)) {
        errors.push(`${file} uses inline main().catch() instead of runCLI(main)`);
      }

      // Should have runCLI(main) call
      if (!RUN_CLI_PATTERN.test(content)) {
        errors.push(`${file} does not use runCLI(main) wrapper`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`WU-1537 runCLI(main) violations (${errors.length}):\n${errors.join('\n')}`);
    }
  });

  /**
   * WU-1537: Verify all CLI entry points import runCLI from cli-entry-point.
   *
   * Files using runCLI(main) must import it from the shared entry point module.
   */
  it('should import runCLI from cli-entry-point in ALL CLI entry points', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryPoints();

    const runCLIImportPattern = /import\s*\{[^}]*runCLI[^}]*\}\s*from\s*['"][^'"]*cli-entry-point/;
    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      if (RUN_CLI_PATTERN.test(content) && !runCLIImportPattern.test(content)) {
        errors.push(`${file} uses runCLI but does not import it from cli-entry-point`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`Missing runCLI imports:\n${errors.join('\n')}`);
    }
  });

  it('should not have unused fileURLToPath imports in CLI files with entry guards', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryPoints();

    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // If the file imports fileURLToPath, it should actually use it somewhere
      // (not just for the now-removed entry guard pattern)
      const hasFileURLToPathImport =
        /import\s*{[^}]*fileURLToPath[^}]*}\s*from\s*['"]node:url['"]/.test(content);
      const usesFileURLToPath = /fileURLToPath\(/.test(content);

      if (hasFileURLToPathImport && !usesFileURLToPath) {
        errors.push(`${file} imports fileURLToPath but does not use it - remove unused import`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`Unused fileURLToPath imports:\n${errors.join('\n')}`);
    }
  });

  it('cli-entry-point.ts JSDoc should document import.meta.main pattern', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliEntryPointPath = path.join(srcDir, 'cli-entry-point.ts');
    const content = readFileSync(cliEntryPointPath, 'utf-8');

    // JSDoc example should show import.meta.main pattern, not the old one
    expect(
      content.includes('import.meta.main'),
      'cli-entry-point.ts JSDoc should mention import.meta.main',
    ).toBe(true);
  });
});
