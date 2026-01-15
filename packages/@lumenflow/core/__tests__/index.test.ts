import { describe, it, expect } from 'vitest';

describe('@lumenflow/core', () => {
  it('exports VERSION constant', async () => {
    const { VERSION } = await import('../src/index.js');
    expect(VERSION).toBe('0.0.0');
  });

  it('exports runGates function', async () => {
    const { runGates } = await import('../src/index.js');
    expect(typeof runGates).toBe('function');
  });

  it('exports git utilities', async () => {
    const { GitAdapter, createGitAdapter } = await import('../src/index.js');
    expect(GitAdapter).toBeDefined();
    expect(typeof createGitAdapter).toBe('function');
  });

  it('exports guards module', async () => {
    const { checkBannedPattern, checkProtectedContext } = await import('../src/index.js');
    expect(typeof checkBannedPattern).toBe('function');
    expect(typeof checkProtectedContext).toBe('function');
  });

  it('exports spawn registry', async () => {
    const { SpawnRegistryStore, validateSpawnEvent } = await import('../src/index.js');
    expect(SpawnRegistryStore).toBeDefined();
    expect(typeof validateSpawnEvent).toBe('function');
  });

  it('exports state bootstrap', async () => {
    const { bootstrap } = await import('../src/index.js');
    expect(typeof bootstrap).toBe('function');
  });
});
