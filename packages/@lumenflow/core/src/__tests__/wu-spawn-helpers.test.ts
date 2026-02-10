import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessExitError } from '../error-handler.js';
import { parseSpawnArgs } from '../wu-spawn-helpers.js';

describe('wu-spawn-helpers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('throws ProcessExitError for --help instead of calling process.exit', () => {
    expect(() => parseSpawnArgs(['node', 'wu-spawn.js', '--help'])).toThrow(ProcessExitError);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
