/* eslint-disable security/detect-non-literal-fs-filename */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

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

export async function recordDelegationTool(
  input: RecordDelegationInput,
): Promise<RecordDelegationResult> {
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

  await mkdir(path.dirname(input.registryPath), { recursive: true });
  await appendFile(input.registryPath, `${JSON.stringify(entry)}\n`, 'utf8');

  return {
    success: true,
    delegationId,
  };
}
