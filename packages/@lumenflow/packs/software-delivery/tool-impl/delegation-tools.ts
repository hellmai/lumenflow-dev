/* eslint-disable security/detect-non-literal-fs-filename */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { UTF8_ENCODING } from '../constants.js';

export interface RecordDelegationInput {
  parentWuId: string;
  targetWuId: string;
  lane: string;
  registryPath: string;
  lineage?: string[];
}

export interface RecordDelegationResult {
  success: boolean;
  delegationId: string;
}

function migrateLegacyStatePath(registryPath: string): string {
  const normalized = registryPath.replace(/\\/g, '/');
  if (normalized.startsWith('.lumenflow/state/')) {
    return path.join('runtime', 'state', normalized.slice('.lumenflow/state/'.length));
  }

  const legacySegment = '/.lumenflow/state/';
  const segmentIndex = normalized.indexOf(legacySegment);
  if (segmentIndex < 0) {
    return registryPath;
  }

  return [
    normalized.slice(0, segmentIndex),
    'runtime',
    'state',
    normalized.slice(segmentIndex + legacySegment.length),
  ]
    .filter(Boolean)
    .join('/');
}

export async function recordDelegationTool(
  input: RecordDelegationInput,
): Promise<RecordDelegationResult> {
  const registryPath = migrateLegacyStatePath(input.registryPath);
  const delegationId = `dlg-${input.parentWuId.toLowerCase()}-${input.targetWuId.toLowerCase()}`;
  const entry = {
    id: delegationId,
    parentWuId: input.parentWuId,
    targetWuId: input.targetWuId,
    lane: input.lane,
    lineage: input.lineage ?? [],
    delegatedAt: new Date().toISOString(),
    status: 'pending',
  };

  await mkdir(path.dirname(registryPath), { recursive: true });
  await appendFile(registryPath, `${JSON.stringify(entry)}\n`, UTF8_ENCODING);

  return {
    success: true,
    delegationId,
  };
}
