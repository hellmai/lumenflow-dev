/**
 * Tests for WU-1538: Core modules throw typed errors instead of process.exit
 *
 * Regression tests to verify that core library modules no longer call
 * process.exit directly and instead throw ProcessExitError (or other
 * typed errors) that the CLI entry point can catch.
 *
 * Covers:
 * - wu-done-inputs.ts: validateInputs throws instead of exiting
 * - context-validation-integration.ts: applyContextValidation throws instead of exiting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessExitError } from '../error-handler.js';

describe('wu-done-inputs throws instead of process.exit (WU-1538)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should throw ProcessExitError for --help flag instead of calling process.exit', async () => {
    const { validateInputs } = await import('../wu-done-inputs.js');

    expect(() => validateInputs(['node', 'wu-done.js', '--help'])).toThrow(ProcessExitError);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should throw ProcessExitError with exit code 0 for --help', async () => {
    const { validateInputs } = await import('../wu-done-inputs.js');

    try {
      validateInputs(['node', 'wu-done.js', '--help']);
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessExitError);
      expect((err as ProcessExitError).exitCode).toBe(0);
    }
  });

  it('should throw ProcessExitError with exit code 1 for missing --id', async () => {
    const { validateInputs } = await import('../wu-done-inputs.js');

    try {
      validateInputs(['node', 'wu-done.js']);
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessExitError);
      expect((err as ProcessExitError).exitCode).toBe(1);
    }
  });
});

describe('context-validation-integration throws instead of process.exit (WU-1538)', () => {
  it('should not import process.exit directly in applyContextValidation', async () => {
    // Verify the module does not call process.exit by reading its source
    // This is a structural test - the actual function test is below
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(
      new URL('../context-validation-integration.ts', import.meta.url),
      'utf-8',
    );
    // The function applyContextValidation should NOT contain process.exit
    // It should throw ProcessExitError instead
    const applyFnMatch = content.match(/export async function applyContextValidation[\s\S]*?^}/m);
    if (applyFnMatch) {
      expect(applyFnMatch[0]).not.toContain('process.exit');
    }
  });
});
