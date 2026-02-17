import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { delegationRecordTool } from '../tools/delegation-tools.js';
import { laneLockToolCapabilities } from '../tools/lane-lock-tool.js';
import {
  acquireLaneLockTool,
  readLaneLockMetadata,
  releaseLaneLockTool,
} from '../tool-impl/lane-lock.js';
import { recordDelegationTool } from '../tool-impl/delegation-tools.js';

describe('software delivery lane lock and delegation tools', () => {
  it('exposes lane lock descriptor via subprocess entry', () => {
    expect(laneLockToolCapabilities.map((tool) => tool.name)).toEqual([
      'lane-lock:acquire',
      'lane-lock:release',
    ]);
    expect(laneLockToolCapabilities.every((tool) => tool.handler.kind === 'subprocess')).toBe(true);
    expect(
      laneLockToolCapabilities.every((tool) => tool.handler.entry.includes('tool-impl/')),
    ).toBe(true);
    expect(
      laneLockToolCapabilities.every(
        (tool) => tool.required_scopes[0]?.pattern === 'runtime/locks/**',
      ),
    ).toBe(true);
    expect(delegationRecordTool.required_scopes[0]?.pattern).toBe('runtime/state/**');
  });

  it('acquires and releases lane locks with staleness detection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lumenflow-pack-lock-'));
    const lockDir = path.join(root, 'locks');
    await mkdir(lockDir, { recursive: true });

    const firstAcquire = await acquireLaneLockTool({
      lane: 'Framework: Core State Recovery',
      wuId: 'WU-1734',
      owner: 'session-a',
      locksDir: lockDir,
      staleAfterMs: 10_000,
    });
    expect(firstAcquire.acquired).toBe(true);

    const secondAcquire = await acquireLaneLockTool({
      lane: 'Framework: Core State Recovery',
      wuId: 'WU-1735',
      owner: 'session-b',
      locksDir: lockDir,
      staleAfterMs: 10_000,
    });
    expect(secondAcquire.acquired).toBe(false);
    expect(secondAcquire.is_stale).toBe(false);

    await writeFile(
      secondAcquire.lock_path,
      JSON.stringify({
        lane: 'Framework: Core State Recovery',
        wuId: 'WU-1736',
        owner: 'session-old',
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      }),
      'utf8',
    );

    const staleAcquire = await acquireLaneLockTool({
      lane: 'Framework: Core State Recovery',
      wuId: 'WU-1737',
      owner: 'session-c',
      locksDir: lockDir,
      staleAfterMs: 1,
    });
    expect(staleAcquire.acquired).toBe(true);
    expect(staleAcquire.is_stale).toBe(true);

    const lockMetadata = await readLaneLockMetadata(staleAcquire.lock_path);
    expect(lockMetadata?.wuId).toBe('WU-1737');

    const release = await releaseLaneLockTool({
      lane: 'Framework: Core State Recovery',
      owner: 'session-c',
      locksDir: lockDir,
    });
    expect(release.released).toBe(true);
  });

  it('records delegation lineage through tool implementation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lumenflow-pack-delegation-'));
    const registryPath = path.join(root, 'delegation-registry.jsonl');

    expect(delegationRecordTool.handler.entry).toContain('delegation-tools.ts');

    const result = await recordDelegationTool({
      parentWuId: 'WU-1733',
      targetWuId: 'WU-1734',
      lane: 'Framework: Core State Recovery',
      registryPath,
      lineage: ['WU-1732', 'WU-1733'],
    });
    expect(result.success).toBe(true);

    const written = await readFile(registryPath, 'utf8');
    expect(written.includes('"parentWuId":"WU-1733"')).toBe(true);
    expect(written.includes('"lineage":["WU-1732","WU-1733"]')).toBe(true);
  });

  it('allows only one stale lock contender to win takeover in parallel', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lumenflow-pack-lock-race-'));
    const lockDir = path.join(root, 'locks');
    await mkdir(lockDir, { recursive: true });

    const staleLock = await acquireLaneLockTool({
      lane: 'Framework: Core State Recovery',
      wuId: 'WU-1800',
      owner: 'session-initial',
      locksDir: lockDir,
      staleAfterMs: 10_000,
    });

    await writeFile(
      staleLock.lock_path,
      JSON.stringify({
        lane: 'Framework: Core State Recovery',
        wuId: 'WU-1799',
        owner: 'session-old',
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
      'utf8',
    );

    const contenders = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        acquireLaneLockTool({
          lane: 'Framework: Core State Recovery',
          wuId: `WU-18${index}`,
          owner: `session-${index}`,
          locksDir: lockDir,
          staleAfterMs: 1,
        }),
      ),
    );

    const winners = contenders.filter((result) => result.acquired);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.is_stale).toBe(true);
  });

  it('migrates legacy .lumenflow/state registry paths to runtime/state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lumenflow-pack-delegation-migration-'));
    const legacyPath = path.join(root, '.lumenflow', 'state', 'delegation-registry.jsonl');
    const runtimePath = path.join(root, 'runtime', 'state', 'delegation-registry.jsonl');

    const result = await recordDelegationTool({
      parentWuId: 'WU-1801',
      targetWuId: 'WU-1802',
      lane: 'Framework: Core State Recovery',
      registryPath: legacyPath,
    });

    expect(result.success).toBe(true);
    const written = await readFile(runtimePath, 'utf8');
    expect(written.includes('"parentWuId":"WU-1801"')).toBe(true);
  });
});
