import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { parseYAML, stringifyYAML } from '../wu-yaml.js';
import { computeInitiativeSyncWriteOnWUComplete } from '../wu-done-initiative-sync.js';

function writeYaml(filePath: string, doc: Record<string, unknown>) {
  writeFileSync(filePath, stringifyYAML(doc), 'utf-8');
}

function getPhaseStatus(initiative: Record<string, unknown>, phaseId: number): string | undefined {
  const phases = Array.isArray(initiative.phases) ? initiative.phases : [];
  const phase = phases.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      Number((candidate as { id?: unknown }).id) === phaseId,
  ) as { status?: string } | undefined;
  return phase?.status;
}

describe('computeInitiativeSyncWriteOnWUComplete', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks the current phase done when the last pending WU in that phase completes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-init-sync-'));
    tempRoots.push(root);

    const wuDir = path.join(root, 'docs/04-operations/tasks/wu');
    const initiativesDir = path.join(root, 'docs/04-operations/tasks/initiatives');
    mkdirSync(wuDir, { recursive: true });
    mkdirSync(initiativesDir, { recursive: true });

    writeYaml(path.join(initiativesDir, 'INIT-200.yaml'), {
      id: 'INIT-200',
      status: 'in_progress',
      phases: [
        { id: 1, title: 'Phase 1', status: 'in_progress' },
        { id: 2, title: 'Phase 2', status: 'pending' },
      ],
    });

    writeYaml(path.join(wuDir, 'WU-2001.yaml'), {
      id: 'WU-2001',
      status: 'done',
      initiative: 'INIT-200',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2002.yaml'), {
      id: 'WU-2002',
      status: 'in_progress',
      initiative: 'INIT-200',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2003.yaml'), {
      id: 'WU-2003',
      status: 'ready',
      initiative: 'INIT-200',
      phase: 2,
    });

    const update = computeInitiativeSyncWriteOnWUComplete({
      wuId: 'WU-2002',
      wuDoc: {
        id: 'WU-2002',
        status: 'done',
        initiative: 'INIT-200',
        phase: 1,
      },
      projectRoot: root,
    });

    expect(update).not.toBeNull();
    const initiative = parseYAML(update!.content) as Record<string, unknown>;
    expect(getPhaseStatus(initiative, 1)).toBe('done');
    expect(getPhaseStatus(initiative, 2)).toBe('pending');
    expect(initiative.status).toBe('in_progress');
  });

  it('marks the initiative done when the final pending WU completes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-init-sync-'));
    tempRoots.push(root);

    const wuDir = path.join(root, 'docs/04-operations/tasks/wu');
    const initiativesDir = path.join(root, 'docs/04-operations/tasks/initiatives');
    mkdirSync(wuDir, { recursive: true });
    mkdirSync(initiativesDir, { recursive: true });

    writeYaml(path.join(initiativesDir, 'INIT-201.yaml'), {
      id: 'INIT-201',
      status: 'in_progress',
      phases: [
        { id: 1, title: 'Phase 1', status: 'done' },
        { id: 2, title: 'Phase 2', status: 'in_progress' },
      ],
    });

    writeYaml(path.join(wuDir, 'WU-2011.yaml'), {
      id: 'WU-2011',
      status: 'done',
      initiative: 'INIT-201',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2012.yaml'), {
      id: 'WU-2012',
      status: 'in_progress',
      initiative: 'INIT-201',
      phase: 2,
    });

    const update = computeInitiativeSyncWriteOnWUComplete({
      wuId: 'WU-2012',
      wuDoc: {
        id: 'WU-2012',
        status: 'done',
        initiative: 'INIT-201',
        phase: 2,
      },
      projectRoot: root,
    });

    expect(update).not.toBeNull();
    const initiative = parseYAML(update!.content) as Record<string, unknown>;
    expect(getPhaseStatus(initiative, 1)).toBe('done');
    expect(getPhaseStatus(initiative, 2)).toBe('done');
    expect(initiative.status).toBe('done');
  });

  it('keeps initiative in_progress when all WUs are done but a phase remains pending', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-init-sync-'));
    tempRoots.push(root);

    const wuDir = path.join(root, 'docs/04-operations/tasks/wu');
    const initiativesDir = path.join(root, 'docs/04-operations/tasks/initiatives');
    mkdirSync(wuDir, { recursive: true });
    mkdirSync(initiativesDir, { recursive: true });

    writeYaml(path.join(initiativesDir, 'INIT-203.yaml'), {
      id: 'INIT-203',
      status: 'in_progress',
      phases: [
        { id: 1, title: 'Phase 1', status: 'in_progress' },
        { id: 2, title: 'Phase 2', status: 'pending' },
      ],
    });

    writeYaml(path.join(wuDir, 'WU-2031.yaml'), {
      id: 'WU-2031',
      status: 'done',
      initiative: 'INIT-203',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2032.yaml'), {
      id: 'WU-2032',
      status: 'in_progress',
      initiative: 'INIT-203',
      phase: 1,
    });

    const update = computeInitiativeSyncWriteOnWUComplete({
      wuId: 'WU-2032',
      wuDoc: {
        id: 'WU-2032',
        status: 'done',
        initiative: 'INIT-203',
        phase: 1,
      },
      projectRoot: root,
    });

    expect(update).not.toBeNull();
    const initiative = parseYAML(update!.content) as Record<string, unknown>;
    expect(getPhaseStatus(initiative, 1)).toBe('done');
    expect(getPhaseStatus(initiative, 2)).toBe('pending');
    expect(initiative.status).toBe('in_progress');
  });

  it('is idempotent for partial completion and does not regress a correct in_progress phase', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-init-sync-'));
    tempRoots.push(root);

    const wuDir = path.join(root, 'docs/04-operations/tasks/wu');
    const initiativesDir = path.join(root, 'docs/04-operations/tasks/initiatives');
    mkdirSync(wuDir, { recursive: true });
    mkdirSync(initiativesDir, { recursive: true });

    writeYaml(path.join(initiativesDir, 'INIT-202.yaml'), {
      id: 'INIT-202',
      status: 'in_progress',
      phases: [{ id: 1, title: 'Phase 1', status: 'in_progress' }],
    });

    writeYaml(path.join(wuDir, 'WU-2021.yaml'), {
      id: 'WU-2021',
      status: 'done',
      initiative: 'INIT-202',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2022.yaml'), {
      id: 'WU-2022',
      status: 'in_progress',
      initiative: 'INIT-202',
      phase: 1,
    });
    writeYaml(path.join(wuDir, 'WU-2023.yaml'), {
      id: 'WU-2023',
      status: 'ready',
      initiative: 'INIT-202',
      phase: 1,
    });

    const update = computeInitiativeSyncWriteOnWUComplete({
      wuId: 'WU-2022',
      wuDoc: {
        id: 'WU-2022',
        status: 'done',
        initiative: 'INIT-202',
        phase: 1,
      },
      projectRoot: root,
    });

    expect(update).toBeNull();
  });

  it('returns null when the WU has no initiative link', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-init-sync-'));
    tempRoots.push(root);

    const update = computeInitiativeSyncWriteOnWUComplete({
      wuId: 'WU-2024',
      wuDoc: {
        id: 'WU-2024',
        status: 'done',
      },
      projectRoot: root,
    });

    expect(update).toBeNull();
  });
});
