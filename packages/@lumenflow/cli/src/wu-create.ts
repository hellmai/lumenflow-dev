#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Create Orchestrator (WU-1262, WU-1439, WU-1651)
 *
 * Race-safe WU creation using shared micro-worktree isolation.
 *
 * WU-1651: Decomposed into focused modules:
 * - wu-create-validation.ts: Spec validation and strict mode checks
 * - wu-create-content.ts: YAML content building, backlog updates, plan templates
 * - wu-create-readiness.ts: Post-create readiness summary display
 * - wu-create-cloud.ts: Cloud mode context builder
 *
 * This file remains the orchestrator, coordinating CLI parsing, validation,
 * content generation, and transaction execution.
 *
 * Canonical sequence:
 * 1) Validate inputs (id, lane, title)
 * 2) Ensure on main branch
 * 3) Use withMicroWorktree() to atomically:
 *    a) Create temp branch without switching main checkout
 *    b) Create WU-{id}.yaml and update backlog.md in micro-worktree
 *    c) Commit with "docs: create wu-{id} for <title>" message
 *    d) Merge to main with ff-only (retry with rebase if needed)
 *    e) Push to origin/main
 *    f) Cleanup temp branch and micro-worktree
 *
 * Usage:
 *   pnpm wu:create --id WU-706 --lane Intelligence --title "Fix XYZ issue"
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { todayISO } from '@lumenflow/core/date-utils';
import { validateLaneFormat, extractParent } from '@lumenflow/core/lane-checker';
import { inferSubLane } from '@lumenflow/core/lane-inference';
import { createWUParser, WU_CREATE_OPTIONS, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { getConfig } from '@lumenflow/core/config';
import { validateSpecRefs, hasSpecRefs } from '@lumenflow/core/wu-create-validators';
import {
  COMMIT_FORMATS,
  ENV_VARS,
  REMOTES,
  STRING_LITERALS,
  WU_TYPES,
} from '@lumenflow/core/wu-constants';
import { ensureOnMain, validateWUIDFormat } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { generateWuIdWithRetry } from '@lumenflow/core/wu-id-generator';
import { lintWUSpec, formatLintErrors } from '@lumenflow/core/wu-lint';
import { WU_CREATE_DEFAULTS } from '@lumenflow/core/wu-create-defaults';
import { isDocsOrProcessType } from '@lumenflow/core/wu-type-helpers';
import { checkInitiativePhases, findInitiative } from '@lumenflow/initiatives';
import { buildCloudCreateContext } from './wu-create-cloud.js';
import {
  detectCloudMode,
  resolveEffectiveCloudActivation,
  CLOUD_ACTIVATION_SOURCE,
  type CloudDetectConfig,
  type EffectiveCloudActivationResult,
} from '@lumenflow/core/cloud-detect';
import {
  buildWuCreateLaneLifecycleMessage,
  ensureLaneLifecycleForProject,
  type LaneLifecycleClassification,
  LANE_LIFECYCLE_STATUS,
} from './lane-lifecycle-process.js';

// WU-1651: Import from extracted modules
import {
  validateCreateSpec,
  containsCodeFiles,
  hasAnyItems,
  type CreateWUOptions,
} from './wu-create-validation.js';
import {
  buildWUContent,
  truncateTitle,
  mergeSpecRefs,
  createPlanTemplate,
  createWUYamlInWorktree,
  updateBacklogInWorktree,
  getPlanProtocolRef,
} from './wu-create-content.js';
import { displayReadinessSummary } from './wu-create-readiness.js';
import { emitSizingAdvisory } from './wu-create-sizing-advisory.js';
import { validateSizingEstimate, type SizingEstimate } from './wu-sizing-validation.js';

// Re-export public API for backward compatibility (tests import from wu-create.js)
export { validateCreateSpec, type CreateWUOptions } from './wu-create-validation.js';
export { buildWUContent } from './wu-create-content.js';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:create]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'wu-create';

/** Default WU priority */
const DEFAULT_PRIORITY = 'P2';

/** Default WU type */
const DEFAULT_TYPE = WU_TYPES.FEATURE;

/** Minimum confidence threshold to show lane suggestion warning (WU-2438: lowered from 50 to 30) */
const MIN_CONFIDENCE_FOR_WARNING = 30;

interface ResolveCreateCloudActivationInput {
  cloudFlag: boolean;
  env: Readonly<Record<string, string | undefined>>;
  config: CloudDetectConfig;
  currentBranch: string;
}

/**
 * Resolve branch-aware cloud activation for wu:create.
 *
 * This keeps cloud detection source attribution while enforcing protected-branch
 * guardrails (main/master).
 */
export function resolveCloudActivationForCreate(
  input: ResolveCreateCloudActivationInput,
): EffectiveCloudActivationResult {
  const detection = detectCloudMode({
    cloudFlag: input.cloudFlag,
    env: input.env,
    config: input.config,
  });
  return resolveEffectiveCloudActivation({
    detection,
    currentBranch: input.currentBranch,
  });
}

/**
 * WU-2330: Check if a more specific sub-lane matches the provided inputs.
 * Non-blocking - just logs a warning if a better lane is suggested.
 *
 * @param {string} providedLane - Lane provided by the user
 * @param {string[]|undefined} codePathsArray - Code paths array from Commander
 * @param {string} title - WU title (used as fallback description)
 * @param {string|undefined} description - WU description
 */
export function warnIfBetterLaneExists(
  providedLane: string,
  codePathsArray: string[] | undefined,
  title: string,
  description: string | undefined,
) {
  if (!codePathsArray?.length && !description) {
    return;
  }

  try {
    const codePaths = codePathsArray ?? [];
    const descForInference = description || title;
    const suggestion = inferSubLane(codePaths, descForInference);

    // Only warn if suggestion differs and confidence is meaningful
    if (suggestion.lane === providedLane || suggestion.confidence < MIN_CONFIDENCE_FOR_WARNING) {
      return;
    }

    // Check if suggestion is more specific (a sub-lane of the provided parent)
    const providedParent = extractParent(providedLane);
    const suggestedParent = extractParent(suggestion.lane);
    const isMoreSpecific = providedParent === suggestedParent && suggestion.lane !== providedLane;
    const isDifferentLane = providedParent !== suggestedParent;

    if (isMoreSpecific || isDifferentLane) {
      console.warn(
        `${LOG_PREFIX} Consider using "${suggestion.lane}" (${suggestion.confidence}% match) instead of "${providedLane}"`,
      );
      console.warn(
        `${LOG_PREFIX}    Run: pnpm wu:infer-lane --paths "${codePaths.join(' ')}" --desc "${title}"`,
      );
    }
  } catch {
    // Non-blocking - if inference fails, continue silently
  }
}

/**
 * Resolve lane lifecycle classification for wu:create without mutating config.
 *
 * WU-1751: wu:create must not persist lifecycle migration side effects to
 * workspace.yaml on main.
 */
export function resolveLaneLifecycleForWuCreate(projectRoot: string): LaneLifecycleClassification {
  return ensureLaneLifecycleForProject(projectRoot, { persist: false });
}

export function collectInitiativeWarnings({
  initiativeId,
  initiativeDoc,
  phase,
  specRefs,
}: {
  initiativeId: string;
  initiativeDoc: Record<string, unknown>;
  phase?: string;
  specRefs?: string[];
}): string[] {
  const warnings: string[] = [];
  const phaseCheck = checkInitiativePhases(initiativeDoc);

  if (!phaseCheck.hasPhases && phaseCheck.warning) {
    warnings.push(phaseCheck.warning);
  }

  if (phaseCheck.hasPhases && !phase) {
    warnings.push(
      `Initiative ${initiativeId} has phases defined. Consider adding --phase to link this WU to a phase.`,
    );
  }

  const relatedPlan = initiativeDoc.related_plan as string | undefined;
  if (relatedPlan && !hasSpecRefs(specRefs)) {
    warnings.push(
      `Initiative ${initiativeId} has related_plan (${relatedPlan}). Consider adding --spec-refs to link this WU to the plan.`,
    );
  }

  return warnings;
}

export interface CloudCreateGitAdapter {
  add(files: string | string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(remote: string, branch: string, options?: { setUpstream?: boolean }): Promise<void>;
}

export interface CloudCreateCommitInput {
  git: CloudCreateGitAdapter;
  wuPath: string;
  backlogPath: string;
  commitMessage: string;
  targetBranch: string;
}

interface SizingArgsInput {
  estimatedFiles?: unknown;
  estimatedToolCalls?: unknown;
  sizingStrategy?: unknown;
  sizingExceptionType?: unknown;
  sizingExceptionReason?: unknown;
}

interface ResolvedSizingEstimateResult {
  sizingEstimate?: SizingEstimate;
  errors: string[];
}

function parseNonNegativeIntegerFlag(
  value: unknown,
  flagName: string,
): { parsed?: number; error?: string } {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) {
      return { parsed: value };
    }
    return { error: `${flagName} must be a non-negative integer` };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return { parsed: Number.parseInt(trimmed, 10) };
    }
  }

  return { error: `${flagName} must be a non-negative integer` };
}

function normalizeOptionalStringFlag(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve optional sizing_estimate fields for wu:create.
 *
 * When any sizing flag is provided, estimated_files, estimated_tool_calls, and
 * sizing_strategy become required as a complete set.
 */
export function resolveSizingEstimateFromCreateArgs(
  args: SizingArgsInput,
): ResolvedSizingEstimateResult {
  const hasAnySizingInput =
    args.estimatedFiles !== undefined ||
    args.estimatedToolCalls !== undefined ||
    args.sizingStrategy !== undefined ||
    args.sizingExceptionType !== undefined ||
    args.sizingExceptionReason !== undefined;

  if (!hasAnySizingInput) {
    return { errors: [] };
  }

  const errors: string[] = [];

  if (args.estimatedFiles === undefined) {
    errors.push('--estimated-files is required when sizing options are provided');
  }
  if (args.estimatedToolCalls === undefined) {
    errors.push('--estimated-tool-calls is required when sizing options are provided');
  }
  if (args.sizingStrategy === undefined) {
    errors.push('--sizing-strategy is required when sizing options are provided');
  }

  const filesResult =
    args.estimatedFiles === undefined
      ? { parsed: undefined }
      : parseNonNegativeIntegerFlag(args.estimatedFiles, '--estimated-files');
  const toolCallsResult =
    args.estimatedToolCalls === undefined
      ? { parsed: undefined }
      : parseNonNegativeIntegerFlag(args.estimatedToolCalls, '--estimated-tool-calls');

  if (filesResult.error) {
    errors.push(filesResult.error);
  }
  if (toolCallsResult.error) {
    errors.push(toolCallsResult.error);
  }

  if (typeof args.sizingStrategy !== 'string' || args.sizingStrategy.trim().length === 0) {
    if (args.sizingStrategy !== undefined) {
      errors.push('--sizing-strategy must be a non-empty string');
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const sizingEstimate: SizingEstimate = {
    estimated_files: filesResult.parsed as number,
    estimated_tool_calls: toolCallsResult.parsed as number,
    strategy: args.sizingStrategy as SizingEstimate['strategy'],
    ...(normalizeOptionalStringFlag(args.sizingExceptionType) && {
      exception_type: normalizeOptionalStringFlag(
        args.sizingExceptionType,
      ) as SizingEstimate['exception_type'],
    }),
    ...(normalizeOptionalStringFlag(args.sizingExceptionReason) && {
      exception_reason: normalizeOptionalStringFlag(args.sizingExceptionReason),
    }),
  };

  const validation = validateSizingEstimate(sizingEstimate);
  if (!validation.valid) {
    return { errors: validation.errors };
  }

  return { sizingEstimate, errors: [] };
}

/**
 * Execute cloud-mode wu:create git operations.
 * Stages WU + backlog files, commits, and pushes to the active cloud branch.
 */
export async function commitCloudCreateArtifacts(input: CloudCreateCommitInput): Promise<void> {
  const { git, wuPath, backlogPath, commitMessage, targetBranch } = input;
  await git.add([wuPath, backlogPath]);
  await git.commit(commitMessage);
  await git.push(REMOTES.ORIGIN, targetBranch, { setUpstream: true });
}

/**
 * Check if WU already exists
 * @param {string} id - WU ID to check
 */
function checkWUExists(id: string) {
  const wuPath = WU_PATHS.WU(id);
  if (existsSync(wuPath)) {
    die(
      `WU already exists: ${wuPath}\n\n` +
        `Options:\n` +
        `  1. Choose a different WU ID\n` +
        `  2. Edit existing WU: pnpm wu:edit --id ${id} --title "..." --acceptance "..."\n` +
        `  3. Delete existing WU: pnpm wu:delete --id ${id} (if obsolete)`,
    );
  }
}

/**
 * Get default assigned_to value from git config user.email (WU-1368)
 * @returns {Promise<string>} User email or empty string if not configured
 */
async function getDefaultAssignedTo() {
  try {
    const email = await getGitForCwd().getConfigValue('user.email');
    return email || '';
  } catch {
    console.warn(`${LOG_PREFIX} git config user.email not set - assigned_to will be empty`);
    return '';
  }
}

export async function main() {
  const args = createWUParser({
    name: 'wu-create',
    description: 'Create a new Work Unit with micro-worktree isolation (race-safe)',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.lane,
      WU_OPTIONS.title,
      WU_OPTIONS.priority,
      WU_OPTIONS.type,
      // Initiative system options (WU-1247)
      WU_OPTIONS.initiative,
      WU_OPTIONS.phase,
      WU_OPTIONS.blockedBy,
      WU_OPTIONS.blocks,
      WU_OPTIONS.labels,
      // WU-1368: Default assigned_to from git config
      WU_OPTIONS.assignedTo,
      // WU-1364: Full spec inline options
      WU_OPTIONS.description,
      WU_OPTIONS.acceptance,
      WU_OPTIONS.notes,
      WU_OPTIONS.codePaths,
      WU_OPTIONS.testPathsManual,
      WU_OPTIONS.testPathsUnit,
      WU_OPTIONS.testPathsE2e,
      WU_OPTIONS.validate,
      // WU-2320: Spec reference for feature WUs
      WU_OPTIONS.specRefs,
      // WU-1998: Exposure field options
      WU_OPTIONS.exposure,
      WU_OPTIONS.userJourney,
      WU_OPTIONS.uiPairingWus,
      // WU-1062: External plan options for wu:create
      WU_CREATE_OPTIONS.plan,
      // WU-2155: Optional sizing_estimate options
      WU_CREATE_OPTIONS.estimatedFiles,
      WU_CREATE_OPTIONS.estimatedToolCalls,
      WU_CREATE_OPTIONS.sizingStrategy,
      WU_CREATE_OPTIONS.sizingExceptionType,
      WU_CREATE_OPTIONS.sizingExceptionReason,
      // WU-1329: Strict validation is default, --no-strict bypasses
      WU_OPTIONS.noStrict,
      // WU-1590: Cloud mode for cloud agents
      WU_OPTIONS.cloud,
    ],
    required: ['lane', 'title'], // WU-1246: --id is now optional (auto-generated if not provided)
    allowPositionalId: false,
  });

  // WU-1246: Auto-generate WU ID if not provided
  let wuId: string;
  if (args.id) {
    wuId = args.id;
    // Validate explicitly provided ID
    validateWUIDFormat(wuId);
  } else {
    // Auto-generate next sequential ID
    console.log(`${LOG_PREFIX} Auto-generating WU ID...`);
    try {
      wuId = await generateWuIdWithRetry();
      console.log(`${LOG_PREFIX} Generated WU ID: ${wuId}`);
    } catch (error) {
      die(
        `Failed to auto-generate WU ID: ${error.message}\n\n` +
          `Options:\n` +
          `  1. Retry the command (transient file system issue)\n` +
          `  2. Provide an explicit ID: --id WU-XXXX\n` +
          `  3. Check for race conditions if running parallel wu:create`,
      );
    }
  }

  console.log(`${LOG_PREFIX} Creating WU ${wuId} in ${args.lane} lane...`);

  // WU-1748: Lane lifecycle boundary enforcement
  // wu:create does not synthesize/design lanes; it requires locked lifecycle.
  const laneLifecycle = resolveLaneLifecycleForWuCreate(process.cwd());
  if (laneLifecycle.status !== LANE_LIFECYCLE_STATUS.LOCKED) {
    die(buildWuCreateLaneLifecycleMessage(laneLifecycle.status));
  }

  // Validate lane format (sub-lane or parent-only)
  try {
    validateLaneFormat(args.lane);
  } catch (error) {
    die(
      `Invalid lane format: ${error.message}\n\n` +
        `Valid formats:\n` +
        `  - Parent-only: "Operations", "Intelligence", "Experience", etc.\n` +
        `  - Sub-lane: "Operations: Tooling", "Intelligence: Prompts", etc.\n\n` +
        `Format rules:\n` +
        `  - Single colon with EXACTLY one space after (e.g., "Parent: Subdomain")\n` +
        `  - No spaces before colon\n` +
        `  - No multiple colons\n\n` +
        `See workspace.yaml software_delivery.lanes.definitions for valid parent lanes.`,
    );
  }

  // WU-2330: Warn if a more specific sub-lane matches code_paths or description
  warnIfBetterLaneExists(args.lane, args.codePaths, args.title, args.description);

  // WU-1590: Build cloud create context for --cloud path
  const config = getConfig();
  const currentBranch = await getGitForCwd().getCurrentBranch();
  const cloudEffective = resolveCloudActivationForCreate({
    cloudFlag: Boolean(args.cloud),
    env: process.env as Record<string, string | undefined>,
    config: config.cloud,
    currentBranch,
  });
  if (cloudEffective.blocked) {
    const sourceHint =
      cloudEffective.source === CLOUD_ACTIVATION_SOURCE.FLAG ? '--cloud' : `${ENV_VARS.CLOUD}=1`;
    die(
      `${LOG_PREFIX} Cloud mode blocked on protected branch "${currentBranch}".\n\n` +
        `Explicit cloud activation (${sourceHint}) is not allowed on main/master.\n` +
        `Switch to a non-main branch for cloud mode, or run without cloud activation on main/master.`,
    );
  }
  if (cloudEffective.suppressed) {
    const signalSuffix = cloudEffective.matchedSignal
      ? ` (signal: ${cloudEffective.matchedSignal})`
      : '';
    console.log(
      `${LOG_PREFIX} Cloud auto-detection suppressed on protected branch "${currentBranch}"${signalSuffix}; continuing with standard flow.`,
    );
  }
  const cloudCtx = buildCloudCreateContext({
    cloud: cloudEffective.isCloud,
    currentBranch,
  });
  if (cloudCtx.isCloud) {
    console.log(`${LOG_PREFIX} Cloud mode: skipping ensureOnMain and micro-worktree isolation`);
  }

  if (!cloudCtx.skipEnsureOnMain) {
    await ensureOnMain(getGitForCwd());
  }
  checkWUExists(wuId);

  // WU-1368: Get assigned_to from flag or git config user.email
  const assignedTo = args.assignedTo || (await getDefaultAssignedTo());
  if (!assignedTo) {
    console.warn(`${LOG_PREFIX} No assigned_to set - WU will need manual assignment`);
  }

  const planSpecRef = args.plan ? getPlanProtocolRef(wuId) : undefined;
  const mergedRefs = mergeSpecRefs(args.specRefs, planSpecRef);

  // WU-1683: Set first-class plan field (symmetric with initiative related_plan)
  const resolvedPlan = args.plan ? getPlanProtocolRef(wuId) : undefined;

  // WU-1443: Apply resilient defaults so a plan-first WU doesn't immediately fail strict validation.
  const effectiveType = args.type || DEFAULT_TYPE;

  const resolvedNotes =
    typeof args.notes === 'string' && args.notes.trim().length > 0
      ? args.notes
      : WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER;
  if (resolvedNotes === WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER) {
    console.warn(`${LOG_PREFIX} No --notes provided; using placeholder notes (edit before done).`);
  }

  const hasProvidedTests =
    hasAnyItems(args.testPathsManual) ||
    hasAnyItems(args.testPathsUnit) ||
    hasAnyItems(args.testPathsE2e);
  const canAutoAddManualTests =
    !hasProvidedTests && !isDocsOrProcessType(effectiveType) && !containsCodeFiles(args.codePaths);

  const resolvedTestPathsManual = canAutoAddManualTests
    ? [WU_CREATE_DEFAULTS.AUTO_MANUAL_TEST_PLACEHOLDER]
    : (args.testPathsManual as string[] | undefined);

  const sizingResolution = resolveSizingEstimateFromCreateArgs(args);
  if (sizingResolution.errors.length > 0) {
    const errorList = sizingResolution.errors
      .map((error) => `  - ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} Sizing estimate options are invalid:\n\n${errorList}`);
  }
  const resolvedSizingEstimate = sizingResolution.sizingEstimate;

  if (canAutoAddManualTests) {
    console.warn(
      `${LOG_PREFIX} No test paths provided; inserting a minimal manual test stub (add automated tests before code changes).`,
    );
  }

  const createSpecValidation = validateCreateSpec({
    id: wuId,
    lane: args.lane,
    title: args.title,
    priority: args.priority || DEFAULT_PRIORITY,
    type: effectiveType,
    opts: {
      description: args.description,
      acceptance: args.acceptance,
      notes: resolvedNotes,
      codePaths: args.codePaths,
      testPathsManual: resolvedTestPathsManual,
      testPathsUnit: args.testPathsUnit,
      testPathsE2e: args.testPathsE2e,
      exposure: args.exposure,
      userJourney: args.userJourney,
      uiPairingWus: args.uiPairingWus,
      specRefs: mergedRefs,
      sizingEstimate: resolvedSizingEstimate,
      initiative: args.initiative,
      phase: args.phase,
      blockedBy: args.blockedBy,
      blocks: args.blocks,
      labels: args.labels,
      assignedTo,
      // WU-1329: Strict validation is default, --no-strict bypasses
      strict: !args.noStrict,
    },
  });

  if (!createSpecValidation.valid) {
    const errorList = createSpecValidation.errors
      .map((error) => `  - ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} Spec validation failed:\n\n${errorList}`);
  }

  console.log(`${LOG_PREFIX} Spec validation passed`);

  // WU-1530: Run spec lint BEFORE micro-worktree creation.
  // Previously this ran inside createWUYamlInWorktree after worktree setup,
  // meaning lint errors only appeared after a ~10s worktree creation.
  const preflightWU = buildWUContent({
    id: wuId,
    lane: args.lane,
    title: args.title,
    priority: args.priority || DEFAULT_PRIORITY,
    type: effectiveType,
    created: todayISO(),
    opts: {
      description: args.description,
      acceptance: args.acceptance,
      notes: resolvedNotes,
      codePaths: args.codePaths,
      testPathsManual: resolvedTestPathsManual,
      testPathsUnit: args.testPathsUnit,
      testPathsE2e: args.testPathsE2e,
      exposure: args.exposure,
      userJourney: args.userJourney,
      uiPairingWus: args.uiPairingWus,
      specRefs: mergedRefs,
      plan: resolvedPlan,
      sizingEstimate: resolvedSizingEstimate,
      initiative: args.initiative,
      phase: args.phase,
      blockedBy: args.blockedBy,
      blocks: args.blocks,
      labels: args.labels,
      assignedTo,
    },
  });
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const preflightLint = lintWUSpec(preflightWU, { invariantsPath, phase: 'intent' });
  if (!preflightLint.valid) {
    const formatted = formatLintErrors(preflightLint.errors);
    die(
      `${LOG_PREFIX} WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before creating this WU.`,
    );
  }

  // WU-2155: Emit sizing advisory when sizing_estimate is present in preflight WU
  const sizingEstimateData = preflightWU.sizing_estimate as SizingEstimate | undefined;
  if (sizingEstimateData) {
    emitSizingAdvisory({
      wuId: wuId,
      logPrefix: LOG_PREFIX,
      sizingEstimate: sizingEstimateData,
    });
  }

  const specRefsList = mergedRefs;
  const specRefsValidation = validateSpecRefs(specRefsList);
  if (!specRefsValidation.valid) {
    const errorList = specRefsValidation.errors
      .map((error) => `  - ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} Spec reference validation failed:\n\n${errorList}`);
  }
  if (specRefsValidation.warnings.length > 0) {
    for (const warning of specRefsValidation.warnings) {
      console.warn(`${LOG_PREFIX} ${warning}`);
    }
  }

  if (args.initiative) {
    const initiative = findInitiative(args.initiative);
    if (initiative) {
      const warnings = collectInitiativeWarnings({
        initiativeId: initiative.id,
        initiativeDoc: initiative.doc as Record<string, unknown>,
        phase: args.phase,
        specRefs: specRefsList,
      });
      for (const warning of warnings) {
        console.warn(`${LOG_PREFIX} ${warning}`);
      }
    }
  }

  if (args.plan) {
    // WU-1755: Pass description/acceptance to pre-fill plan template
    createPlanTemplate(wuId, args.title, {
      description: args.description,
      acceptance: args.acceptance,
    });
  }

  // Transaction: micro-worktree isolation (WU-1439) or cloud direct commit (WU-1590)
  try {
    const priority = args.priority || DEFAULT_PRIORITY;
    const type = effectiveType;

    // WU-1590: Shared create options for both paths
    const createOpts: CreateWUOptions = {
      // Initiative system fields (WU-1247)
      initiative: args.initiative,
      phase: args.phase,
      blockedBy: args.blockedBy,
      blocks: args.blocks,
      labels: args.labels,
      // WU-1368: Assigned to
      assignedTo,
      // WU-1364: Full spec inline options
      description: args.description,
      acceptance: args.acceptance,
      notes: resolvedNotes,
      codePaths: args.codePaths,
      testPathsManual: resolvedTestPathsManual,
      testPathsUnit: args.testPathsUnit,
      testPathsE2e: args.testPathsE2e,
      // WU-1998: Exposure field options
      exposure: args.exposure,
      userJourney: args.userJourney,
      uiPairingWus: args.uiPairingWus,
      // WU-2320: Spec references
      specRefs: mergedRefs,
      // WU-1683: First-class plan field
      plan: resolvedPlan,
      // WU-2155: Optional sizing estimate
      sizingEstimate: resolvedSizingEstimate,
    };

    if (cloudCtx.skipMicroWorktree) {
      // WU-1590: Cloud path - write and commit directly on current branch
      const cwd = process.cwd();
      const wuPath = createWUYamlInWorktree(
        cwd,
        wuId,
        args.lane,
        args.title,
        priority,
        type,
        createOpts,
      );
      const backlogPath = updateBacklogInWorktree(cwd, wuId, args.lane, args.title);

      const shortTitle = truncateTitle(args.title);
      const commitMessage = COMMIT_FORMATS.CREATE(wuId, shortTitle);
      await commitCloudCreateArtifacts({
        git: getGitForCwd(),
        wuPath,
        backlogPath,
        commitMessage,
        targetBranch: cloudCtx.targetBranch,
      });

      console.log(`${LOG_PREFIX} Cloud mode: committed WU spec on ${cloudCtx.targetBranch}`);
    } else {
      // Standard path: micro-worktree isolation
      const previousWuTool = process.env[ENV_VARS.WU_TOOL];
      process.env[ENV_VARS.WU_TOOL] = OPERATION_NAME;
      try {
        await withMicroWorktree({
          operation: OPERATION_NAME,
          id: wuId,
          logPrefix: LOG_PREFIX,
          execute: async ({ worktreePath }) => {
            // Create WU YAML in micro-worktree
            const wuPath = createWUYamlInWorktree(
              worktreePath,
              wuId,
              args.lane,
              args.title,
              priority,
              type,
              createOpts,
            );

            // Update backlog.md in micro-worktree
            const backlogPath = updateBacklogInWorktree(worktreePath, wuId, args.lane, args.title);

            // Build commit message
            const shortTitle = truncateTitle(args.title);
            const commitMessage = COMMIT_FORMATS.CREATE(wuId, shortTitle);

            // Return commit message and files to commit
            return {
              commitMessage,
              files: [wuPath, backlogPath],
            };
          },
        });
      } finally {
        if (previousWuTool === undefined) {
          delete process.env[ENV_VARS.WU_TOOL];
        } else {
          process.env[ENV_VARS.WU_TOOL] = previousWuTool;
        }
      }
    }

    console.log(`\n${LOG_PREFIX} Transaction complete!`);
    console.log(`\nWU ${wuId} created successfully:`);
    console.log(`  File: ${WU_PATHS.WU(wuId)}`);
    console.log(`  Lane: ${args.lane}`);
    console.log(`  Status: ready`);

    // WU-1620: Display readiness summary
    displayReadinessSummary(wuId);
  } catch (error) {
    die(
      `Transaction failed: ${error.message}\n\n` +
        `${cloudCtx.skipMicroWorktree ? 'Cloud commit' : 'Micro-worktree cleanup was attempted automatically.'}\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
    );
  }
}

// Guard main() for testability (WU-1366)
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
