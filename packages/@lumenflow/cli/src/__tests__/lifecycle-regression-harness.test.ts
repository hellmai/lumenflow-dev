import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LifecycleHarnessError,
  runLifecycleRegressionHarness,
} from '../lifecycle-regression-harness.js';

const createdDirs: string[] = [];

describe('lifecycle regression harness (WU-1516)', () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('reproduces create->claim->done->delete->doctor with clean projections', async () => {
    const projectDir = join(tmpdir(), `wu-1516-harness-${Date.now()}-green`);
    createdDirs.push(projectDir);

    const result = await runLifecycleRegressionHarness({
      projectDir,
      wuId: 'WU-9716',
      lane: 'Framework: Core Lifecycle',
      title: 'Lifecycle regression test',
    });

    expect(result.stageOrder).toEqual(['create', 'claim', 'done', 'delete', 'doctor']);
    expect(result.diagnosis.summary.brokenEvents).toBe(0);
    expect(result.backlogProjection).not.toContain('WU-9716');
    expect(result.statusProjection).not.toContain('WU-9716');
  });

  it('reports the exact failing stage when broken events remain', async () => {
    const projectDir = join(tmpdir(), `wu-1516-harness-${Date.now()}-red`);
    createdDirs.push(projectDir);

    await expect(
      runLifecycleRegressionHarness({
        projectDir,
        wuId: 'WU-9717',
        lane: 'Framework: Core Lifecycle',
        title: 'Lifecycle regression stage error test',
        skipDoctorFix: true,
      }),
    ).rejects.toMatchObject<Partial<LifecycleHarnessError>>({
      stage: 'doctor',
    });
  });
});
