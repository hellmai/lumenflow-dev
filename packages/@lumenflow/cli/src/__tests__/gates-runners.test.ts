import { describe, it, expect } from 'vitest';
import { resolveIncrementalTestCommand } from '../gates-runners.js';

describe('resolveIncrementalTestCommand (WU-1678)', () => {
  it('hardens vitest --changed commands with stable args', () => {
    const resolved = resolveIncrementalTestCommand({
      testRunner: 'vitest',
      configuredIncrementalCommand: 'pnpm vitest run --changed origin/main',
    });

    expect(resolved).toContain('pnpm vitest run');
    expect(resolved).toContain('--changed origin/main');
    expect(resolved).toContain('--maxWorkers=1');
    expect(resolved).toContain('--teardownTimeout=30000');
  });

  it('uses stable vitest incremental command when no config command is provided', () => {
    const resolved = resolveIncrementalTestCommand({
      testRunner: 'vitest',
      configuredIncrementalCommand: undefined,
    });

    expect(resolved).toContain('pnpm vitest run');
    expect(resolved).toContain('--changed origin/main');
  });

  it('preserves custom vitest command that does not use --changed', () => {
    const resolved = resolveIncrementalTestCommand({
      testRunner: 'vitest',
      configuredIncrementalCommand:
        'pnpm vitest run packages/@lumenflow/cli/src/__tests__/wu-done.test.ts',
    });

    expect(resolved).toBe('pnpm vitest run packages/@lumenflow/cli/src/__tests__/wu-done.test.ts');
  });

  it('preserves non-vitest incremental commands', () => {
    const resolved = resolveIncrementalTestCommand({
      testRunner: 'jest',
      configuredIncrementalCommand: 'npm test -- --onlyChanged',
    });

    expect(resolved).toBe('npm test -- --onlyChanged');
  });
});
