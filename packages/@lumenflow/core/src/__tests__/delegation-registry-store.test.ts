// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DelegationRegistryStore } from '../delegation-registry-store.js';
import { DelegationIntent, DelegationStatus } from '../delegation-registry-schema.js';

function createBriefAttestation() {
  return {
    algorithm: 'sha256' as const,
    promptHash: 'b'.repeat(64),
    promptLength: 2048,
    generatedAt: new Date().toISOString(),
    clientName: 'codex-cli',
  };
}

describe('delegation-registry-store', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records and loads brief attestation metadata', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'delegation-store-'));
    tempDirs.push(tempDir);
    const store = new DelegationRegistryStore(tempDir);
    await store.load();

    const briefAttestation = createBriefAttestation();
    const delegationId = await store.record(
      'WU-3000',
      'WU-3001',
      'Operations: Tooling',
      DelegationIntent.DELEGATION,
      briefAttestation,
    );

    const entry = store.getById(delegationId);
    expect(entry?.briefAttestation).toEqual(briefAttestation);
  });

  it('preserves brief attestation across pickup and completion updates', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'delegation-store-'));
    tempDirs.push(tempDir);
    const store = new DelegationRegistryStore(tempDir);
    await store.load();

    const briefAttestation = createBriefAttestation();
    const delegationId = await store.record(
      'WU-3002',
      'WU-3003',
      'Operations: Tooling',
      DelegationIntent.DELEGATION,
      briefAttestation,
    );

    await store.recordPickup(delegationId, 'agent@test.com', new Date().toISOString());
    await store.updateStatus(delegationId, DelegationStatus.COMPLETED);

    const reloadedStore = new DelegationRegistryStore(tempDir);
    await reloadedStore.load();
    const entry = reloadedStore.getById(delegationId);

    expect(entry?.briefAttestation).toEqual(briefAttestation);
    expect(entry?.status).toBe(DelegationStatus.COMPLETED);
    expect(entry?.pickedUpBy).toBe('agent@test.com');
  });
});

