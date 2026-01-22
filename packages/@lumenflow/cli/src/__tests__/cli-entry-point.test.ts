/**
 * Tests for CLI entry point error handling
 *
 * Verifies that runCLI wrapper properly:
 * - Catches async errors from main()
 * - Logs error messages to stderr
 * - Exits with EXIT_CODES.ERROR on failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
