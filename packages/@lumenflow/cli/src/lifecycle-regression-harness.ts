import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  diagnoseState,
  type StateDiagnosis,
  type StateDoctorDeps,
} from '@lumenflow/core/dist/state-doctor-core.js';
import { generateBacklog, generateStatus } from '@lumenflow/core/dist/backlog-generator.js';
import { WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';
import { WUStateStore, WU_EVENTS_FILE_NAME } from '@lumenflow/core/dist/wu-state-store.js';
import { parseYAML, stringifyYAML } from '@lumenflow/core/dist/wu-yaml.js';

const PATHS = {
  wuDir: join('docs', '04-operations', 'tasks', 'wu'),
  stateDir: join('.lumenflow', 'state'),
  stampsDir: join('.lumenflow', 'stamps'),
};

export type LifecycleStage = 'create' | 'claim' | 'done' | 'delete' | 'doctor';

export interface LifecycleHarnessOptions {
  projectDir: string;
  wuId: string;
  lane: string;
  title: string;
  skipDoctorFix?: boolean;
}

export interface LifecycleHarnessResult {
  stageOrder: LifecycleStage[];
  diagnosis: StateDiagnosis;
  backlogProjection: string;
  statusProjection: string;
}

export class LifecycleHarnessError extends Error {
  stage: LifecycleStage;

  constructor(stage: LifecycleStage, message: string, cause?: unknown) {
    super(`[${stage}] ${message}`);
    this.name = 'LifecycleHarnessError';
    this.stage = stage;
    if (cause) {
      this.cause = cause;
    }
  }
}

async function withStage<T>(stage: LifecycleStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LifecycleHarnessError) {
      throw error;
    }
    throw new LifecycleHarnessError(
      stage,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

function assertStage(condition: boolean, stage: LifecycleStage, message: string): void {
  if (!condition) {
    throw new LifecycleHarnessError(stage, message);
  }
}

function wuPath(projectDir: string, wuId: string): string {
  return join(projectDir, PATHS.wuDir, `${wuId}.yaml`);
}

function eventsPath(projectDir: string): string {
  return join(projectDir, PATHS.stateDir, WU_EVENTS_FILE_NAME);
}

async function readEvents(projectDir: string): Promise<Array<Record<string, unknown>>> {
  const eventFile = eventsPath(projectDir);
  if (!existsSync(eventFile)) return [];
  const lines = (await readFile(eventFile, 'utf8'))
    .split('\n')
    .filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function writeEvents(
  projectDir: string,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  const eventFile = eventsPath(projectDir);
  const payload = events.map((event) => JSON.stringify(event)).join('\n');
  await writeFile(eventFile, payload.length > 0 ? `${payload}\n` : '', 'utf8');
}

async function createDoctorDeps(projectDir: string): Promise<StateDoctorDeps> {
  return {
    listWUs: async () => {
      const dir = join(projectDir, PATHS.wuDir);
      if (!existsSync(dir)) return [];
      const entries = await readdir(dir);
      const docs = [];
      for (const file of entries) {
        if (!file.endsWith('.yaml')) continue;
        const parsed = parseYAML(await readFile(join(dir, file), 'utf8')) as Record<
          string,
          unknown
        >;
        docs.push({
          id: String(parsed.id),
          status: String(parsed.status),
          lane: parsed.lane ? String(parsed.lane) : undefined,
          title: parsed.title ? String(parsed.title) : undefined,
        });
      }
      return docs;
    },
    listStamps: async () => {
      const dir = join(projectDir, PATHS.stampsDir);
      if (!existsSync(dir)) return [];
      const entries = await readdir(dir);
      return entries
        .filter((file) => file.endsWith('.done'))
        .map((file) => file.replace('.done', ''));
    },
    listSignals: async () => [],
    listEvents: async () => {
      const events = await readEvents(projectDir);
      return events.map((event) => ({
        wuId: String(event.wuId ?? event.wu_id ?? ''),
        type: String(event.type ?? ''),
        timestamp: event.timestamp ? String(event.timestamp) : undefined,
        lane: event.lane ? String(event.lane) : undefined,
        title: event.title ? String(event.title) : undefined,
        reason: event.reason ? String(event.reason) : undefined,
      }));
    },
    removeEvent: async (wuId: string) => {
      const events = await readEvents(projectDir);
      const filtered = events.filter((event) => String(event.wuId ?? event.wu_id ?? '') !== wuId);
      await writeEvents(projectDir, filtered);
    },
  };
}

export async function runLifecycleRegressionHarness(
  options: LifecycleHarnessOptions,
): Promise<LifecycleHarnessResult> {
  const { projectDir, wuId, lane, title, skipDoctorFix = false } = options;
  const stageOrder: LifecycleStage[] = [];
  const stateDir = join(projectDir, PATHS.stateDir);
  const wuDir = join(projectDir, PATHS.wuDir);

  await mkdir(wuDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(projectDir, PATHS.stampsDir), { recursive: true });

  await withStage('create', async () => {
    stageOrder.push('create');
    const doc = {
      id: wuId,
      title,
      lane,
      type: 'refactor',
      status: WU_STATUS.READY,
      priority: 'P2',
      created: '2026-02-07',
      description: 'Lifecycle harness test WU',
      acceptance: ['Create, claim, complete, delete, doctor'],
      code_paths: ['packages/@lumenflow/cli/src/lifecycle-regression-harness.ts'],
      tests: { manual: ['Run lifecycle harness test'], unit: [], e2e: [] },
      exposure: 'backend-only',
    };
    await writeFile(wuPath(projectDir, wuId), stringifyYAML(doc), 'utf8');
    assertStage(existsSync(wuPath(projectDir, wuId)), 'create', `expected ${wuId}.yaml to exist`);
  });

  const store = new WUStateStore(stateDir);
  await store.load();

  await withStage('claim', async () => {
    stageOrder.push('claim');
    await store.claim(wuId, lane, title);
    const current = store.getWUState(wuId);
    assertStage(
      current?.status === WU_STATUS.IN_PROGRESS,
      'claim',
      `expected ${wuId} status to be in_progress after claim`,
    );
  });

  await withStage('done', async () => {
    stageOrder.push('done');
    await store.complete(wuId);
    const current = store.getWUState(wuId);
    assertStage(current?.status === WU_STATUS.DONE, 'done', `expected ${wuId} status to be done`);
  });

  await withStage('delete', async () => {
    stageOrder.push('delete');
    await unlink(wuPath(projectDir, wuId));
    assertStage(
      !existsSync(wuPath(projectDir, wuId)),
      'delete',
      `expected ${wuId}.yaml to be deleted`,
    );
  });

  const diagnosis = await withStage('doctor', async () => {
    stageOrder.push('doctor');
    const deps = await createDoctorDeps(projectDir);
    const result = await diagnoseState(projectDir, deps, { fix: !skipDoctorFix });
    const verification = skipDoctorFix
      ? result
      : await diagnoseState(projectDir, await createDoctorDeps(projectDir), { fix: false });
    assertStage(
      verification.summary.brokenEvents === 0,
      'doctor',
      `expected no Broken Event issues after doctor (found ${verification.summary.brokenEvents})`,
    );
    return verification;
  });

  const cleanStore = new WUStateStore(stateDir);
  await cleanStore.load();
  const backlogProjection = await generateBacklog(cleanStore, { projectRoot: projectDir, wuDir });
  const statusProjection = await generateStatus(cleanStore);

  assertStage(
    !backlogProjection.includes(wuId),
    'doctor',
    `expected backlog projection to exclude deleted ${wuId}`,
  );
  assertStage(
    !statusProjection.includes(wuId),
    'doctor',
    `expected status projection to exclude deleted ${wuId}`,
  );

  return {
    stageOrder,
    diagnosis,
    backlogProjection,
    statusProjection,
  };
}
