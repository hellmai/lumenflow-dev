import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { WU_STATUS } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import { parseYAML, stringifyYAML } from './wu-yaml.js';

const INIT_STATUS = {
  IN_PROGRESS: WU_STATUS.IN_PROGRESS,
  DONE: WU_STATUS.DONE,
  ARCHIVED: 'archived',
} as const;

const PHASE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: WU_STATUS.IN_PROGRESS,
  DONE: WU_STATUS.DONE,
  BLOCKED: WU_STATUS.BLOCKED,
} as const;

const DONE_WU_STATUSES = new Set([WU_STATUS.DONE, WU_STATUS.COMPLETED]);

interface InitiativePhaseDoc {
  id?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

interface InitiativeDoc {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
  phases?: unknown;
  [key: string]: unknown;
}

interface WUSummary {
  id: string;
  status: string;
  phase: number | null;
}

interface SyncInput {
  wuId: string;
  wuDoc: Record<string, unknown>;
  projectRoot: string;
}

export interface InitiativeSyncWrite {
  initiativeId: string;
  initiativePath: string;
  content: string;
}

function normalizeStatus(status: unknown): string {
  return typeof status === 'string' ? status.trim().toLowerCase() : '';
}

function normalizePhaseId(phase: unknown): number | null {
  if (typeof phase === 'number' && Number.isInteger(phase) && phase > 0) {
    return phase;
  }
  if (typeof phase === 'string' && phase.trim()) {
    const parsed = Number(phase);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDoneStatus(status: string): boolean {
  return DONE_WU_STATUSES.has(status);
}

function derivePhaseStatus(wusInPhase: WUSummary[]): string {
  if (wusInPhase.length === 0) {
    return PHASE_STATUS.PENDING;
  }
  const statuses = wusInPhase.map((wu) => wu.status);

  if (statuses.every((status) => isDoneStatus(status))) {
    return PHASE_STATUS.DONE;
  }
  if (statuses.some((status) => status === WU_STATUS.IN_PROGRESS)) {
    return PHASE_STATUS.IN_PROGRESS;
  }
  if (statuses.some((status) => status === WU_STATUS.BLOCKED)) {
    return PHASE_STATUS.BLOCKED;
  }
  // If work has started (some done) but not complete, the phase is in progress.
  if (statuses.some((status) => isDoneStatus(status))) {
    return PHASE_STATUS.IN_PROGRESS;
  }
  return PHASE_STATUS.PENDING;
}

function hasIncompletePhase(phases: unknown): boolean {
  if (!Array.isArray(phases) || phases.length === 0) {
    return false;
  }

  return phases.some((phaseEntry) => {
    const phase = toRecord(phaseEntry);
    if (!phase) {
      return true;
    }
    return normalizeStatus(phase.status) !== PHASE_STATUS.DONE;
  });
}

function deriveInitiativeStatus(
  currentStatus: string,
  initiativeWUs: WUSummary[],
  phases: unknown,
): string {
  if (currentStatus === INIT_STATUS.ARCHIVED || initiativeWUs.length === 0) {
    return currentStatus;
  }
  if (!initiativeWUs.every((wu) => isDoneStatus(wu.status))) {
    return INIT_STATUS.IN_PROGRESS;
  }
  if (hasIncompletePhase(phases)) {
    return INIT_STATUS.IN_PROGRESS;
  }
  return INIT_STATUS.DONE;
}

function parseYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = parseYAML(readFileSync(filePath, 'utf-8'));
    return toRecord(parsed);
  } catch {
    return null;
  }
}

function findInitiativePath(
  initiativesDir: string,
  initiativeRef: string,
): { initiativePath: string; initiativeDoc: InitiativeDoc } | null {
  const directPath = path.join(initiativesDir, `${initiativeRef}.yaml`);
  if (existsSync(directPath)) {
    const directDoc = parseYamlFile(directPath);
    const directId = typeof directDoc?.id === 'string' ? directDoc.id : '';
    if (directDoc && directId) {
      return { initiativePath: directPath, initiativeDoc: directDoc };
    }
  }

  if (!existsSync(initiativesDir)) {
    return null;
  }

  const files = readdirSync(initiativesDir).filter((file) => file.endsWith('.yaml'));
  const refLower = initiativeRef.toLowerCase();

  for (const file of files) {
    const candidatePath = path.join(initiativesDir, file);
    const candidateDoc = parseYamlFile(candidatePath);
    if (!candidateDoc) {
      continue;
    }
    const candidateId = typeof candidateDoc.id === 'string' ? candidateDoc.id : '';
    const candidateSlug = typeof candidateDoc.slug === 'string' ? candidateDoc.slug : '';

    if (candidateId.toLowerCase() === refLower || candidateSlug.toLowerCase() === refLower) {
      return { initiativePath: candidatePath, initiativeDoc: candidateDoc };
    }
  }

  return null;
}

function collectInitiativeWUs({
  wuDir,
  initiativeRefs,
  currentWuId,
  currentWuDoc,
}: {
  wuDir: string;
  initiativeRefs: Set<string>;
  currentWuId: string;
  currentWuDoc: Record<string, unknown>;
}): WUSummary[] {
  if (!existsSync(wuDir)) {
    return [];
  }

  const files = readdirSync(wuDir).filter(
    (file) => file.startsWith('WU-') && file.endsWith('.yaml'),
  );
  const summaries: WUSummary[] = [];
  let foundCurrent = false;
  const currentStatus = normalizeStatus(currentWuDoc.status);
  const currentPhase = normalizePhaseId(currentWuDoc.phase);
  const currentInitiative = normalizeStatus(currentWuDoc.initiative);

  for (const file of files) {
    const filePath = path.join(wuDir, file);
    const wu = parseYamlFile(filePath);
    if (!wu) {
      continue;
    }

    const wuId = typeof wu.id === 'string' ? wu.id : '';
    const wuInitiative = normalizeStatus(wu.initiative);
    if (!wuId || !initiativeRefs.has(wuInitiative)) {
      continue;
    }

    if (wuId === currentWuId) {
      foundCurrent = true;
      summaries.push({
        id: wuId,
        status: currentStatus || normalizeStatus(wu.status),
        phase: currentPhase ?? normalizePhaseId(wu.phase),
      });
      continue;
    }

    summaries.push({
      id: wuId,
      status: normalizeStatus(wu.status),
      phase: normalizePhaseId(wu.phase),
    });
  }

  if (!foundCurrent && currentInitiative && initiativeRefs.has(currentInitiative)) {
    summaries.push({
      id: currentWuId,
      status: currentStatus,
      phase: currentPhase,
    });
  }

  return summaries;
}

export function computeInitiativeSyncWriteOnWUComplete(
  input: SyncInput,
): InitiativeSyncWrite | null {
  const initiativeRef = typeof input.wuDoc.initiative === 'string' ? input.wuDoc.initiative : '';
  if (!initiativeRef) {
    return null;
  }

  const paths = createWuPaths({ projectRoot: input.projectRoot });
  const initiativesDir = path.join(input.projectRoot, paths.INITIATIVES_DIR());
  const resolved = findInitiativePath(initiativesDir, initiativeRef);
  if (!resolved) {
    return null;
  }

  const initiativeDoc = resolved.initiativeDoc;
  const initiativeId = typeof initiativeDoc.id === 'string' ? initiativeDoc.id : '';
  if (!initiativeId) {
    return null;
  }

  const initiativeSlug = typeof initiativeDoc.slug === 'string' ? initiativeDoc.slug : '';
  const initiativeRefs = new Set(
    [initiativeRef, initiativeId, initiativeSlug].map(normalizeStatus),
  );
  const wuDir = path.join(input.projectRoot, paths.WU_DIR());

  const initiativeWUs = collectInitiativeWUs({
    wuDir,
    initiativeRefs,
    currentWuId: input.wuId,
    currentWuDoc: input.wuDoc,
  });

  const nextDoc: InitiativeDoc = { ...initiativeDoc };
  const phases = Array.isArray(initiativeDoc.phases) ? (initiativeDoc.phases as unknown[]) : [];
  let phaseChanged = false;

  if (phases.length > 0) {
    nextDoc.phases = phases.map((phaseEntry) => {
      const phase = toRecord(phaseEntry) as InitiativePhaseDoc | null;
      if (!phase) {
        return phaseEntry;
      }
      const phaseId = normalizePhaseId(phase.id);
      if (phaseId === null) {
        return phaseEntry;
      }

      const wusInPhase = initiativeWUs.filter((wu) => wu.phase === phaseId);
      if (wusInPhase.length === 0) {
        return phaseEntry;
      }

      const nextStatus = derivePhaseStatus(wusInPhase);
      const currentStatus = normalizeStatus(phase.status);
      if (currentStatus === nextStatus) {
        return phaseEntry;
      }

      phaseChanged = true;
      return { ...phase, status: nextStatus };
    });
  }

  const currentInitiativeStatus = normalizeStatus(initiativeDoc.status);
  const nextInitiativeStatus = deriveInitiativeStatus(
    currentInitiativeStatus,
    initiativeWUs,
    nextDoc.phases,
  );
  const statusChanged =
    nextInitiativeStatus !== '' && nextInitiativeStatus !== currentInitiativeStatus;

  if (statusChanged) {
    nextDoc.status = nextInitiativeStatus;
  }

  if (!phaseChanged && !statusChanged) {
    return null;
  }

  return {
    initiativeId,
    initiativePath: resolved.initiativePath,
    content: stringifyYAML(nextDoc),
  };
}
