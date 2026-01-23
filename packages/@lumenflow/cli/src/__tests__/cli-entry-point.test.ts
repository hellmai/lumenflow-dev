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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runCLI } from '../cli-entry-point.js';
import { EXIT_CODES } from '@lumenflow/core/dist/wu-constants.js';

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
});

/**
 * WU-1071: Verify CLI entry points use import.meta.main pattern
 *
 * The old pattern `process.argv[1] === fileURLToPath(import.meta.url)` fails with
 * pnpm symlinks because process.argv[1] is the symlink path but import.meta.url
 * resolves to the real path - they never match so main() is never called.
 *
 * The fix is to use `import.meta.main` (Node.js 22.16.0+ built-in) which correctly
 * handles symlinks.
 */
describe('WU-1071: CLI entry point patterns', () => {
  // CLI files that should have the main() entry guard
  const CLI_FILES_WITH_ENTRY_GUARD = [
    'gates.ts',
    'wu-spawn.ts',
    'wu-create.ts',
    'wu-claim.ts',
    'wu-done.ts',
  ] as const;

  // Old broken pattern that fails with pnpm symlinks
  const OLD_BROKEN_PATTERN =
    /if\s*\(\s*process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)\s*\)/;

  // New working pattern using import.meta.main
  const NEW_WORKING_PATTERN = /if\s*\(\s*import\.meta\.main\s*\)/;

  it('should use import.meta.main instead of process.argv[1] comparison', () => {
    const srcDir = path.resolve(__dirname, '..');

    for (const file of CLI_FILES_WITH_ENTRY_GUARD) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Should NOT have old broken pattern
      expect(
        OLD_BROKEN_PATTERN.test(content),
        `${file} should not use the old broken pattern (process.argv[1] === fileURLToPath)`,
      ).toBe(false);

      // Should have new working pattern
      expect(NEW_WORKING_PATTERN.test(content), `${file} should use import.meta.main pattern`).toBe(
        true,
      );
    }
  });

  it('should not have unused fileURLToPath imports in CLI files with entry guards', () => {
    const srcDir = path.resolve(__dirname, '..');

    for (const file of CLI_FILES_WITH_ENTRY_GUARD) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // If the file imports fileURLToPath, it should actually use it somewhere
      // (not just for the now-removed entry guard pattern)
      const hasFileURLToPathImport =
        /import\s*{[^}]*fileURLToPath[^}]*}\s*from\s*['"]node:url['"]/.test(content);
      const usesFileURLToPath = /fileURLToPath\(/.test(content);

      if (hasFileURLToPathImport && !usesFileURLToPath) {
        expect.fail(`${file} imports fileURLToPath but does not use it - remove unused import`);
      }
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
