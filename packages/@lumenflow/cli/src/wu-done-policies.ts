// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getDocsOnlyPrefixes, DOCS_ONLY_ROOT_FILES } from '@lumenflow/core';
import { DelegationRegistryStore } from '@lumenflow/core/delegation-registry-store';
import { getConfig } from '@lumenflow/core/config';
import { die, getErrorMessage } from '@lumenflow/core/error-handler';
import { isDocumentationType } from '@lumenflow/core/wu-type-helpers';
import {
  CLI_FLAGS,
  EMOJI,
  LOG_PREFIX,
  PKG_MANAGER,
  SCRIPTS,
  WU_EXPOSURE,
  WU_TYPES,
} from '@lumenflow/core/wu-constants';
import { getLatestWuBriefEvidence, WUStateStore } from '@lumenflow/core/wu-state-store';
import { validateExposure, validateFeatureAccessibility } from '@lumenflow/core/wu-validation';
import { createSignal } from '@lumenflow/memory/signal';
import { resolveStateDir } from './state-path-resolvers.js';

interface WUDocLike extends Record<string, unknown> {
  initiative?: string;
  lane?: string;
  type?: string;
}

export const WU_BRIEF_POLICY_MODES = ['off', 'manual', 'auto', 'required'] as const;
export type WuBriefPolicyMode = (typeof WU_BRIEF_POLICY_MODES)[number];
const DEFAULT_WU_BRIEF_POLICY_MODE: WuBriefPolicyMode = 'auto';
const PREP_LOG_PREFIX = '[wu-prep]';
const PREP_FORCE_REASON_REQUIRED_MESSAGE =
  'Missing required --reason for wu:brief policy bypass in wu:prep.';

interface SpawnEntryLike {
  pickedUpAt?: string;
  pickedUpBy?: string;
}

interface ExposureOptions {
  skipExposureCheck?: boolean;
}

/**
 * WU-1999: Print exposure validation warnings.
 *
 * Validates exposure field and UI pairing for user-facing WUs.
 * Non-blocking - logs warnings but doesn't prevent completion.
 */
export function printExposureWarnings(wu: Record<string, unknown>, options: ExposureOptions = {}) {
  const result = validateExposure(wu, { skipExposureCheck: options.skipExposureCheck });

  if (result.warnings.length > 0) {
    console.log(`\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1999: Exposure validation warnings:`);
    for (const warning of result.warnings) {
      console.log(`${LOG_PREFIX.DONE}   ${warning}`);
    }
    console.log(
      `${LOG_PREFIX.DONE} These are non-blocking warnings. ` +
        `To skip, use --skip-exposure-check flag.\n`,
    );
  }
}

interface AccessibilityOptions {
  skipAccessibilityCheck?: boolean;
}

/**
 * WU-2022: Validate feature accessibility for UI-exposed WUs.
 *
 * BLOCKING validation - prevents wu:done if exposure=ui but feature is not accessible.
 */
export function validateAccessibilityOrDie(
  wu: Record<string, unknown>,
  options: AccessibilityOptions = {},
) {
  const result = validateFeatureAccessibility(wu, {
    skipAccessibilityCheck: options.skipAccessibilityCheck,
  });

  if (!result.valid) {
    console.log(
      `\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} WU-2022: Feature accessibility validation failed`,
    );
    die(
      `❌ FEATURE ACCESSIBILITY VALIDATION FAILED (WU-2022)\n\n` +
        `Cannot complete wu:done - UI feature accessibility not verified.\n\n` +
        `${result.errors.join('\n\n')}\n\n` +
        `This gate prevents "orphaned code" - features that exist but users cannot access.`,
    );
  }
}

interface DocsOnlyArgs {
  docsOnly?: boolean;
}

/**
 * WU-1012: Validate --docs-only flag usage.
 */
export function validateDocsOnlyFlag(
  wu: Record<string, unknown>,
  args: DocsOnlyArgs,
): { valid: boolean; errors: string[] } {
  if (!args.docsOnly) {
    return { valid: true, errors: [] };
  }

  const wuId = wu.id || 'unknown';
  const exposure = wu.exposure as string | undefined;
  const type = wu.type as string | undefined;
  const codePaths = wu.code_paths as string[] | undefined;

  if (exposure === WU_EXPOSURE.DOCUMENTATION) {
    return { valid: true, errors: [] };
  }

  if (isDocumentationType(type)) {
    return { valid: true, errors: [] };
  }

  const docsOnlyPrefixes = getDocsOnlyPrefixes().map((prefix) => prefix.toLowerCase());
  const isDocsPath = (p: string): boolean => {
    const normalizedPath = p.trim().toLowerCase();
    for (const prefix of docsOnlyPrefixes) {
      if (normalizedPath.startsWith(prefix)) {
        return true;
      }
    }
    if (normalizedPath.endsWith('.md')) {
      return true;
    }
    for (const pattern of DOCS_ONLY_ROOT_FILES) {
      if (normalizedPath.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  };

  if (codePaths && Array.isArray(codePaths) && codePaths.length > 0) {
    const allDocsOnly = codePaths.every((p) => typeof p === 'string' && isDocsPath(p));
    if (allDocsOnly) {
      return { valid: true, errors: [] };
    }
  }

  const currentExposure = exposure || 'not set';
  const currentType = type || 'not set';

  return {
    valid: false,
    errors: [
      `--docs-only flag used on ${wuId} but WU is not documentation-focused.\n\n` +
        `Current exposure: ${currentExposure}\n` +
        `Current type: ${currentType}\n\n` +
        `--docs-only requires one of:\n` +
        `  1. exposure: documentation\n` +
        `  2. type: documentation\n` +
        `  3. All code_paths under configured docs prefixes (${docsOnlyPrefixes.join(', ')}), or *.md files\n\n` +
        `To fix, either:\n` +
        `  - Remove --docs-only flag and run full gates\n` +
        `  - Change WU exposure to 'documentation' if this is truly a docs-only change`,
    ],
  };
}

interface BuildGatesOptions {
  docsOnly?: boolean;
  isDocsOnly?: boolean;
}

/**
 * WU-1012: Build gates command with --docs-only flag support.
 */
export function buildGatesCommand(options: BuildGatesOptions): string {
  const { docsOnly = false, isDocsOnly = false } = options;
  if (docsOnly || isDocsOnly) {
    return `${PKG_MANAGER} ${SCRIPTS.GATES} -- ${CLI_FLAGS.DOCS_ONLY}`;
  }
  return `${PKG_MANAGER} ${SCRIPTS.GATES}`;
}

/**
 * Enforce wu:brief evidence for feature and bug WUs.
 */
export function shouldEnforceWuBriefEvidence(doc: WUDocLike): boolean {
  return doc.type === WU_TYPES.FEATURE || doc.type === WU_TYPES.BUG;
}

function isWuBriefPolicyMode(value: unknown): value is WuBriefPolicyMode {
  return (
    typeof value === 'string' &&
    WU_BRIEF_POLICY_MODES.includes(value as (typeof WU_BRIEF_POLICY_MODES)[number])
  );
}

export function resolveWuBriefPolicyMode(
  config: ReturnType<typeof getConfig> = getConfig(),
): WuBriefPolicyMode {
  const configured = config.wu?.brief?.policyMode;
  if (isWuBriefPolicyMode(configured)) {
    return configured;
  }
  return DEFAULT_WU_BRIEF_POLICY_MODE;
}

/**
 * Build remediation guidance when wu:brief evidence is missing.
 */
export function buildMissingWuBriefEvidenceMessage(id: string): string {
  return (
    `Missing wu:brief evidence for ${id}.\n\n` +
    `Completion policy requires an auditable wu:brief execution record for feature/bug WUs.\n\n` +
    `Fix options:\n` +
    `  1. If you are delegating this WU, generate handoff prompt + evidence:\n` +
    `     pnpm wu:brief --id ${id}\n` +
    `  2. If you are implementing this WU yourself, record evidence only:\n` +
    `     pnpm wu:brief --id ${id} --evidence-only\n` +
    `  3. Retry completion:\n` +
    `     pnpm wu:done --id ${id}\n` +
    `  4. Legacy/manual override (audited):\n` +
    `     pnpm wu:done --id ${id} --force`
  );
}

export function buildMissingWuBriefEvidenceMessageForPrep(
  id: string,
  mode: WuBriefPolicyMode,
): string {
  return (
    `Missing wu:brief evidence for ${id} (policy=${mode}).\n\n` +
    `wu:prep enforces wu:brief evidence when policy mode is required.\n\n` +
    `Fix options:\n` +
    `  1. Record evidence by generating a brief prompt:\n` +
    `     pnpm wu:brief --id ${id}\n` +
    `  2. If self-implementing, record evidence only:\n` +
    `     pnpm wu:brief --id ${id} --evidence-only\n` +
    `  3. Retry prep:\n` +
    `     pnpm wu:prep --id ${id}\n` +
    `  4. Emergency audited bypass (requires explicit reason):\n` +
    `     pnpm wu:prep --id ${id} --force --reason "<why bypass is required>"`
  );
}

export async function recordWuBriefPrepBypassAudit(options: {
  wuId: string;
  baseDir?: string;
  reason: string;
  policyMode: WuBriefPolicyMode;
}): Promise<void> {
  const baseDir = options.baseDir ?? process.cwd();
  const stateDir = resolveStateDir(baseDir);
  const store = new WUStateStore(stateDir);
  await store.checkpoint(
    options.wuId,
    `[wu:brief] prep force bypass accepted (${options.policyMode}): ${options.reason}`,
    {
      progress: 'wu:brief policy bypass',
      nextSteps: `policy=${options.policyMode}`,
    },
  );
}

export async function enforceWuBriefEvidenceForPrep(
  id: string,
  doc: WUDocLike,
  options: {
    baseDir?: string;
    mode?: WuBriefPolicyMode;
    force?: boolean;
    reason?: string;
    getBriefEvidenceFn?: typeof getLatestWuBriefEvidence;
    blocker?: (message: string) => void;
    warn?: (message: string) => void;
    recordBypassAudit?: typeof recordWuBriefPrepBypassAudit;
  } = {},
): Promise<void> {
  if (!shouldEnforceWuBriefEvidence(doc)) {
    return;
  }

  const mode = options.mode ?? resolveWuBriefPolicyMode();
  if (mode === 'off' || mode === 'manual') {
    return;
  }

  const baseDir = options.baseDir ?? process.cwd();
  const stateDir = resolveStateDir(baseDir);
  const force = options.force === true;
  const getBriefEvidenceFn = options.getBriefEvidenceFn ?? getLatestWuBriefEvidence;
  const blocker = options.blocker ?? ((message: string) => die(message));
  const warn = options.warn ?? console.warn;
  const recordBypassAudit = options.recordBypassAudit ?? recordWuBriefPrepBypassAudit;

  let evidence;
  try {
    evidence = await getBriefEvidenceFn(stateDir, id);
  } catch (error) {
    if (mode === 'required' && !force) {
      blocker(buildWuBriefEvidenceReadFailureMessage(id, stateDir, error));
      return;
    }

    warn(
      `${PREP_LOG_PREFIX} ${EMOJI.WARNING} Could not verify wu:brief evidence for ${id}: ${getErrorMessage(error)}`,
    );
    return;
  }

  if (evidence) {
    return;
  }

  if (mode === 'auto') {
    warn(`${PREP_LOG_PREFIX} ${EMOJI.WARNING} wu:brief evidence missing for ${id} (policy=auto).`);
    warn(buildMissingWuBriefEvidenceMessageForPrep(id, mode));
    return;
  }

  if (!force) {
    blocker(buildMissingWuBriefEvidenceMessageForPrep(id, mode));
    return;
  }

  const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
  if (!reason) {
    blocker(PREP_FORCE_REASON_REQUIRED_MESSAGE);
    return;
  }

  await recordBypassAudit({ wuId: id, baseDir, reason, policyMode: mode });
  warn(
    `${PREP_LOG_PREFIX} ${EMOJI.WARNING} wu:brief policy override accepted for ${id} (policy=${mode}, reason="${reason}").`,
  );
}

function buildWuBriefEvidenceReadFailureMessage(
  id: string,
  stateDir: string,
  error: unknown,
): string {
  return (
    `Could not verify wu:brief evidence for ${id}.\n\n` +
    `State path: ${stateDir}\n` +
    `Error: ${getErrorMessage(error)}\n\n` +
    `Fix options:\n` +
    `  1. Repair/restore state store, then rerun wu:done\n` +
    `  2. Use --force for audited override when recovery is not possible`
  );
}

export async function enforceWuBriefEvidenceForDone(
  id: string,
  doc: WUDocLike,
  options: {
    baseDir?: string;
    force?: boolean;
    getBriefEvidenceFn?: typeof getLatestWuBriefEvidence;
    blocker?: (message: string) => void;
    warn?: (message: string) => void;
  } = {},
): Promise<void> {
  if (!shouldEnforceWuBriefEvidence(doc)) {
    return;
  }

  const baseDir = options.baseDir ?? process.cwd();
  const force = options.force === true;
  const stateDir = resolveStateDir(baseDir);
  const getBriefEvidenceFn = options.getBriefEvidenceFn ?? getLatestWuBriefEvidence;
  const blocker = options.blocker ?? ((message: string) => die(message));
  const warn = options.warn ?? console.warn;

  let evidence;
  try {
    evidence = await getBriefEvidenceFn(stateDir, id);
  } catch (error) {
    if (!force) {
      blocker(buildWuBriefEvidenceReadFailureMessage(id, stateDir, error));
      return;
    }

    warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2132: brief evidence verification failed for ${id}, override accepted via --force`,
    );
    return;
  }

  if (evidence) {
    return;
  }

  if (!force) {
    blocker(buildMissingWuBriefEvidenceMessage(id));
    return;
  }

  warn(
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2132: brief evidence override accepted for ${id} via --force`,
  );
}

/**
 * Returns true when completion should enforce spawn provenance.
 */
export function shouldEnforceSpawnProvenance(doc: WUDocLike): boolean {
  return typeof doc?.initiative === 'string' && doc.initiative.trim().length > 0;
}

/**
 * Build actionable remediation guidance for missing spawn provenance.
 */
export function buildMissingSpawnProvenanceMessage(id: string, initiativeId: string): string {
  return (
    `Missing spawn provenance for initiative-governed WU ${id} (${initiativeId}).\n\n` +
    `This completion path enforces auditable delegation lineage for initiative work.\n\n` +
    `Fix options:\n` +
    `  1. Re-run with --force for an audited override (legacy/manual workflow)\n` +
    `  2. Register spawn lineage before completion (preferred):\n` +
    `     pnpm wu:delegate --id ${id} --parent-wu WU-XXXX --client codex-cli\n\n` +
    `Then retry: pnpm wu:done --id ${id}`
  );
}

/**
 * Build actionable remediation guidance for intent-only spawn provenance.
 */
export function buildMissingSpawnPickupEvidenceMessage(id: string, initiativeId: string): string {
  return (
    `Missing pickup evidence for initiative-governed WU ${id} (${initiativeId}).\n\n` +
    `Delegation intent exists, but this WU has no claim-time pickup handshake.\n` +
    `Completion policy requires both intent and pickup evidence.\n\n` +
    `Fix options:\n` +
    `  1. Re-run with --force for an audited override (legacy/manual claim)\n` +
    `  2. Ensure future delegated work is picked up via wu:claim (records handshake automatically)\n\n` +
    `Then retry: pnpm wu:done --id ${id}`
  );
}

/**
 * Returns true when spawn provenance includes claim-time pickup evidence.
 */
export function hasSpawnPickupEvidence(spawnEntry: SpawnEntryLike | null | undefined): boolean {
  const pickedUpAt =
    typeof spawnEntry?.pickedUpAt === 'string' && spawnEntry.pickedUpAt.trim().length > 0
      ? spawnEntry.pickedUpAt
      : '';
  const pickedUpBy =
    typeof spawnEntry?.pickedUpBy === 'string' && spawnEntry.pickedUpBy.trim().length > 0
      ? spawnEntry.pickedUpBy
      : '';
  return pickedUpAt.length > 0 && pickedUpBy.length > 0;
}

/**
 * Record forced spawn-provenance bypass in memory signals for auditability.
 */
async function recordSpawnProvenanceOverride(
  id: string,
  doc: WUDocLike,
  baseDir: string = process.cwd(),
): Promise<void> {
  try {
    const initiativeId = typeof doc?.initiative === 'string' ? doc.initiative.trim() : 'unknown';
    const lane = typeof doc?.lane === 'string' ? doc.lane : undefined;
    const result = await createSignal(baseDir, {
      message: `spawn-provenance override used for ${id} in ${initiativeId} via --force`,
      wuId: id,
      lane,
    });
    if (result.success) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Spawn-provenance override recorded (${result.signal.id})`,
      );
    }
  } catch (err) {
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not record spawn-provenance override: ${getErrorMessage(err)}`,
    );
  }
}

/**
 * Enforce spawn provenance policy for initiative-governed WUs before completion.
 */
export async function enforceSpawnProvenanceForDone(
  id: string,
  doc: WUDocLike,
  options: {
    baseDir?: string;
    force?: boolean;
  } = {},
): Promise<void> {
  if (!shouldEnforceSpawnProvenance(doc)) {
    return;
  }

  const initiativeId =
    typeof doc.initiative === 'string' && doc.initiative.trim() ? doc.initiative.trim() : 'unknown';
  const baseDir = options.baseDir ?? process.cwd();
  const force = options.force === true;
  const store = new DelegationRegistryStore(resolveStateDir(baseDir));
  await store.load();

  const spawnEntry = store.getByTarget(id) as SpawnEntryLike | null;
  if (!spawnEntry) {
    if (!force) {
      die(buildMissingSpawnProvenanceMessage(id, initiativeId));
    }

    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1599: spawn provenance override accepted for ${id} (${initiativeId}) via --force`,
    );
    await recordSpawnProvenanceOverride(id, doc, baseDir);
    return;
  }

  if (hasSpawnPickupEvidence(spawnEntry)) {
    return;
  }

  if (!force) {
    die(buildMissingSpawnPickupEvidenceMessage(id, initiativeId));
  }

  console.warn(
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1605: pickup evidence override accepted for ${id} (${initiativeId}) via --force`,
  );
  await recordSpawnProvenanceOverride(id, doc, baseDir);
}
