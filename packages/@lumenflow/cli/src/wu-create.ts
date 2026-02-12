#!/usr/bin/env node

/**
 * WU Create Helper (WU-1262, WU-1439)
 *
 * Race-safe WU creation using shared micro-worktree isolation.
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
 * Benefits:
 * - Main checkout never switches branches (no impact on other agents)
 * - Race conditions handled via rebase+retry (up to 3 attempts)
 * - Cleanup guaranteed even on failure
 *
 * Usage:
 *   pnpm wu:create --id WU-706 --lane Intelligence --title "Fix XYZ issue"
 *
 * Context: WU-705 (fix agent coordination failures), WU-1262 (micro-worktree isolation),
 *          WU-1439 (refactor to shared helper)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
// WU-1352: Use centralized YAML functions from wu-yaml.ts
import { stringifyYAML } from '@lumenflow/core/wu-yaml';
// WU-1428: Use date-utils for consistent YYYY-MM-DD format (library-first)
import { todayISO } from '@lumenflow/core/date-utils';
import { validateLaneFormat, extractParent } from '@lumenflow/core/lane-checker';
// WU-2330: Import lane inference for sub-lane suggestions
import { inferSubLane } from '@lumenflow/core/lane-inference';
import { parseBacklogFrontmatter } from '@lumenflow/core/backlog-parser';
import { createWUParser, WU_CREATE_OPTIONS, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { getConfig } from '@lumenflow/core/config';
import { validateWU } from '@lumenflow/core/wu-schema';
import { getPlanPath, getPlanProtocolRef, getPlansDir } from '@lumenflow/core/lumenflow-home';
import { hasSpecRefs, validateSpecRefs } from '@lumenflow/core/wu-create-validators';
import {
  COMMIT_FORMATS,
  FILE_SYSTEM,
  READINESS_UI,
  REMOTES,
  STRING_LITERALS,
  WU_TYPES,
} from '@lumenflow/core/wu-constants';
// WU-1593: Use centralized validateWUIDFormat (DRY)
import { ensureOnMain, validateWUIDFormat } from '@lumenflow/core/wu-helpers';
// WU-1439: Use shared micro-worktree helper
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
// WU-1246: Auto-generate WU IDs when --id not provided
import { generateWuIdWithRetry } from '@lumenflow/core/wu-id-generator';
// WU-1620: Import spec completeness validator for readiness summary
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
// WU-1620: Import readWU to read back created YAML for validation
import { readWU } from '@lumenflow/core/wu-yaml';
// WU-2253: Import WU spec linter for acceptance/code_paths validation
import { lintWUSpec, formatLintErrors } from '@lumenflow/core/wu-lint';
// WU-1329: Import path existence validators for strict mode
import {
  validateCodePathsExistence,
  validateTestPathsExistence,
} from '@lumenflow/core/wu-preflight-validators';
// WU-1025: Import placeholder validator for inline content validation
import { validateNoPlaceholders, buildPlaceholderErrorMessage } from '@lumenflow/core/wu-validator';
import { isCodeFile } from '@lumenflow/core/manual-test-validator';
import { WU_CREATE_DEFAULTS } from '@lumenflow/core/wu-create-defaults';
import { isDocsOrProcessType, hasAnyTests, hasManualTests } from '@lumenflow/core/wu-type-helpers';
// WU-1211: Import initiative validation for phase check
import { checkInitiativePhases, findInitiative } from '@lumenflow/initiatives';
// WU-1590: Cloud create context builder for --cloud path
import { buildCloudCreateContext } from './wu-create-cloud.js';
// WU-1495: Cloud auto-detection from config-driven env signals
import { detectCloudMode } from '@lumenflow/core/cloud-detect';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:create]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'wu-create';

/** Default WU priority */
const DEFAULT_PRIORITY = 'P2';

/** Default WU type */
const DEFAULT_TYPE = WU_TYPES.FEATURE;

/** Maximum title length before truncation */
const MAX_TITLE_LENGTH = 60;

/** Truncation suffix */
const TRUNCATION_SUFFIX = '...';

/** Truncated title length (MAX_TITLE_LENGTH - TRUNCATION_SUFFIX.length) */
const TRUNCATED_TITLE_LENGTH = MAX_TITLE_LENGTH - TRUNCATION_SUFFIX.length;

/** Minimum confidence threshold to show lane suggestion warning (WU-2438: lowered from 50 to 30) */
const MIN_CONFIDENCE_FOR_WARNING = 30;

function containsCodeFiles(codePaths: string[] | undefined): boolean {
  if (!codePaths || codePaths.length === 0) return false;
  return codePaths.some((p) => isCodeFile(p));
}

function hasAnyItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
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
 * Truncate title for commit message if needed
 * @param {string} title - Original title
 * @returns {string} Truncated title
 */
function truncateTitle(title) {
  return title.length > MAX_TITLE_LENGTH
    ? `${title.substring(0, TRUNCATED_TITLE_LENGTH)}${TRUNCATION_SUFFIX}`
    : title;
}

/**
 * WU-1620: Display readiness summary after create/edit
 *
 * Shows whether WU is ready for wu:claim based on spec completeness.
 * Non-blocking - just informational to help agents understand what's missing.
 *
 * @param {string} id - WU ID
 */
function displayReadinessSummary(id: string) {
  try {
    const wuPath = WU_PATHS.WU(id);
    const wuDoc = readWU(wuPath, id);

    const { valid, errors } = validateSpecCompleteness(wuDoc, id);

    const {
      BOX,
      BOX_WIDTH,
      MESSAGES,
      ERROR_MAX_LENGTH,
      ERROR_TRUNCATE_LENGTH,
      TRUNCATION_SUFFIX,
      PADDING,
    } = READINESS_UI;

    console.log(`\n${BOX.TOP_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.TOP_RIGHT}`);
    if (valid) {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_YES}${''.padEnd(PADDING.READY_YES)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const claimCmd = `Run: pnpm wu:claim --id ${id}`;
      console.log(
        `${BOX.VERTICAL} ${claimCmd}${''.padEnd(BOX_WIDTH - claimCmd.length - 1)}${BOX.VERTICAL}`,
      );
    } else {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_NO}${''.padEnd(PADDING.READY_NO)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.MISSING_HEADER}${''.padEnd(PADDING.MISSING_HEADER)}${BOX.VERTICAL}`,
      );
      for (const error of errors) {
        // Truncate long error messages to fit box
        const truncated =
          error.length > ERROR_MAX_LENGTH
            ? `${error.substring(0, ERROR_TRUNCATE_LENGTH)}${TRUNCATION_SUFFIX}`
            : error;
        console.log(
          `${BOX.VERTICAL}   ${MESSAGES.BULLET} ${truncated}${''.padEnd(Math.max(0, PADDING.ERROR_BULLET - truncated.length))}${BOX.VERTICAL}`,
        );
      }
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const editCmd = `Run: pnpm wu:edit --id ${id} --help`;
      console.log(
        `${BOX.VERTICAL} ${editCmd}${''.padEnd(BOX_WIDTH - editCmd.length - 1)}${BOX.VERTICAL}`,
      );
    }
    console.log(`${BOX.BOTTOM_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.BOTTOM_RIGHT}`);
  } catch (err) {
    // Non-blocking - if validation fails, just warn
    console.warn(`${LOG_PREFIX} ⚠️  Could not validate readiness: ${err.message}`);
  }
}

/** Options for creating WU YAML */
interface CreateWUOptions {
  initiative?: string;
  phase?: string;
  blockedBy?: string[];
  blocks?: string[];
  labels?: string[];
  assignedTo?: string;
  description?: string;
  acceptance?: string[];
  notes?: string;
  codePaths?: string[];
  testPathsManual?: string[];
  testPathsUnit?: string[];
  testPathsE2e?: string[];
  exposure?: string;
  userJourney?: string;
  uiPairingWus?: string[];
  specRefs?: string[];
  // WU-1329: Strict validation flag
  strict?: boolean;
}

function mergeSpecRefs(specRefs?: string[], extraRef?: string): string[] {
  const refs = specRefs ? [...specRefs] : [];
  if (extraRef && !refs.includes(extraRef)) {
    refs.push(extraRef);
  }
  return refs;
}

function createPlanTemplate(wuId: string, title: string): string {
  const plansDir = getPlansDir();
  mkdirSync(plansDir, { recursive: true });

  const planPath = getPlanPath(wuId);
  if (existsSync(planPath)) {
    die(
      `Plan already exists: ${planPath}\n\n` +
        `Options:\n` +
        `  1. Open the existing plan and continue editing\n` +
        `  2. Delete or rename the existing plan before retrying\n` +
        `  3. Run wu:create without --plan`,
    );
  }

  const today = todayISO();
  const content =
    `# ${wuId} Plan — ${title}\n\n` +
    `Created: ${today}\n\n` +
    `## Goal\n\n` +
    `## Scope\n\n` +
    `## Approach\n\n` +
    `## Risks\n\n` +
    `## Open Questions\n`;

  writeFileSync(planPath, content, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} ✅ Created plan template: ${planPath}`);
  return planPath;
}

export function buildWUContent({
  id,
  lane,
  title,
  priority,
  type,
  created,
  opts,
}: {
  id: string;
  lane: string;
  title: string;
  priority: string;
  type: string;
  created: string;
  opts: CreateWUOptions;
}) {
  const {
    description,
    acceptance,
    notes,
    codePaths,
    testPathsManual,
    testPathsUnit,
    testPathsE2e,
    initiative,
    phase,
    blockedBy,
    blocks,
    labels,
    assignedTo,
    exposure,
    userJourney,
    uiPairingWus,
    specRefs,
  } = opts;

  // Arrays come directly from Commander.js repeatable options - no parsing needed
  const code_paths = codePaths ?? [];

  const tests = {
    manual: testPathsManual ?? [],
    unit: testPathsUnit ?? [],
    e2e: testPathsE2e ?? [],
  };

  // WU-1443: Auto-insert minimal manual test stub for plan-first specs when no tests are provided,
  // as long as code_paths does not include actual code files (automated tests still required for code).
  if (!isDocsOrProcessType(type) && !hasAnyTests(tests) && !containsCodeFiles(code_paths)) {
    tests.manual = [WU_CREATE_DEFAULTS.AUTO_MANUAL_TEST_PLACEHOLDER];
  }

  return {
    id,
    title,
    lane,
    type,
    status: 'ready',
    priority,
    created,
    description,
    acceptance,
    code_paths,
    tests,
    artifacts: [WU_PATHS.STAMP(id)],
    dependencies: [],
    risks: [],
    // WU-1443: Default notes to non-empty placeholder to avoid strict completeness failures.
    notes:
      typeof notes === 'string' && notes.trim().length > 0
        ? notes
        : WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER,
    requires_review: false,
    ...(initiative && { initiative }),
    ...(phase && { phase: parseInt(phase, 10) }),
    ...(blockedBy?.length && { blocked_by: blockedBy }),
    ...(blocks?.length && { blocks }),
    ...(labels?.length && { labels }),
    ...(assignedTo && { assigned_to: assignedTo }),
    ...(exposure && { exposure }),
    ...(userJourney && { user_journey: userJourney }),
    ...(uiPairingWus?.length && { ui_pairing_wus: uiPairingWus }),
    ...(specRefs?.length && { spec_refs: specRefs }),
  };
}

/**
 * Validate WU spec for creation
 *
 * WU-1329: Strict mode (default) validates that code_paths and test_paths exist on disk.
 * Use opts.strict = false to bypass path existence checks.
 *
 * @param params - Validation parameters
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCreateSpec({
  id,
  lane,
  title,
  priority,
  type,
  opts,
}: {
  id: string;
  lane: string;
  title: string;
  priority: string;
  type: string;
  opts: CreateWUOptions;
}) {
  const errors = [];
  const effectiveType = type || DEFAULT_TYPE;
  // WU-1329: Strict mode is the default
  const strict = opts.strict !== false;

  // WU-1329: Log when strict validation is bypassed
  if (!strict) {
    console.warn(
      `${LOG_PREFIX} WARNING: strict validation bypassed (--no-strict). Path existence checks skipped.`,
    );
  }

  if (!opts.description) {
    errors.push('--description is required');
  }

  if (!opts.acceptance || opts.acceptance.length === 0) {
    errors.push('--acceptance is required (repeatable)');
  }

  if (!opts.exposure) {
    errors.push('--exposure is required');
  }

  const hasTestPaths =
    hasAnyItems(opts.testPathsManual) ||
    hasAnyItems(opts.testPathsUnit) ||
    hasAnyItems(opts.testPathsE2e);
  const hasManualTestPaths = hasManualTests({ manual: opts.testPathsManual });

  if (!isDocsOrProcessType(effectiveType)) {
    const codePaths = opts.codePaths ?? [];
    if (codePaths.length === 0) {
      errors.push('--code-paths is required for non-documentation WUs');
    }

    // WU-1443: Plan-first WUs may not know tests yet.
    // Allow auto-manual stub ONLY when code_paths does not include code files.
    const canAutoAddManualTests =
      !hasTestPaths && codePaths.length > 0 && !containsCodeFiles(codePaths);
    if (!hasTestPaths && !canAutoAddManualTests) {
      errors.push(
        'At least one test path flag is required (--test-paths-manual, --test-paths-unit, or --test-paths-e2e)',
      );
    }

    if (!hasManualTestPaths && !canAutoAddManualTests) {
      errors.push('--test-paths-manual is required for non-documentation WUs');
    }
  }

  if (effectiveType === WU_TYPES.FEATURE && !hasSpecRefs(opts.specRefs)) {
    errors.push(
      '--spec-refs is required for type: feature WUs\n' +
        '    Tip: Create a plan first with: pnpm plan:create --id <WU-ID> --title "..."\n' +
        '    Then use --plan flag or --spec-refs lumenflow://plans/<WU-ID>-plan.md',
    );
  }

  // WU-1530: Single-pass validation — collect all errors before returning.
  // Always build WU content and run all validation stages, even when early fields are missing.
  // buildWUContent handles undefined gracefully; Zod catches missing required fields.

  // Stage 2b: Placeholder check (only meaningful if fields exist)
  if (opts.description && opts.acceptance && opts.acceptance.length > 0) {
    const placeholderResult = validateNoPlaceholders({
      description: opts.description,
      acceptance: opts.acceptance,
    });

    if (!placeholderResult.valid) {
      errors.push(buildPlaceholderErrorMessage('wu:create', placeholderResult));
    }
  }

  // Stage 2c-2d: Schema + completeness — always run to catch enum/format errors
  // even when required fields are missing (Zod reports both)
  const today = todayISO();
  const wuContent = buildWUContent({
    id,
    lane,
    title,
    priority,
    type: effectiveType,
    created: today,
    opts,
  });

  const schemaResult = validateWU(wuContent);
  if (!schemaResult.success) {
    // Deduplicate: skip schema errors already covered by field-level checks above
    const fieldErrorFields = new Set(['description', 'acceptance', 'code_paths', 'tests']);
    const schemaErrors = schemaResult.error.issues
      .filter((issue) => !fieldErrorFields.has(issue.path[0] as string) || errors.length === 0)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    errors.push(...schemaErrors);
  }

  // Only run completeness if schema passed (it depends on well-formed data)
  if (schemaResult.success) {
    const completeness = validateSpecCompleteness(wuContent, id);
    if (!completeness.valid) {
      errors.push(...completeness.errors);
    }
  }

  // Stage 2e: Strict mode validates path existence
  if (strict) {
    const rootDir = process.cwd();

    if (opts.codePaths && opts.codePaths.length > 0) {
      const codePathsResult = validateCodePathsExistence(opts.codePaths, rootDir);
      if (!codePathsResult.valid) {
        errors.push(...codePathsResult.errors);
      }
    }

    const testsObj = {
      unit: opts.testPathsUnit || [],
      e2e: opts.testPathsE2e || [],
    };
    const testPathsResult = validateTestPathsExistence(testsObj, rootDir);
    if (!testPathsResult.valid) {
      errors.push(...testPathsResult.errors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Create WU YAML file in micro-worktree
 *
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} id - WU ID
 * @param {string} lane - WU lane
 * @param {string} title - WU title
 * @param {string} priority - WU priority
 * @param {string} type - WU type
 * @param {Object} opts - Additional options
 * @returns {string} Relative path to created YAML file
 */
function createWUYamlInWorktree(
  worktreePath: string,
  id: string,
  lane: string,
  title: string,
  priority: string,
  type: string,
  opts: CreateWUOptions = {},
) {
  const wuRelativePath = WU_PATHS.WU(id);
  const wuAbsolutePath = join(worktreePath, wuRelativePath);
  const wuDir = join(worktreePath, WU_PATHS.WU_DIR());

  mkdirSync(wuDir, { recursive: true });

  // WU-1428: Use todayISO() for consistent YYYY-MM-DD format (library-first)
  const today = todayISO();

  const wuContent = buildWUContent({
    id,
    lane,
    title,
    priority,
    type,
    created: today,
    opts,
  });

  // WU-1539: Validate WU structure before writing (fail-fast, no placeholders)
  // WU-1750: Zod transforms normalize embedded newlines in arrays and strings
  const validationResult = validateWU(wuContent);
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join(STRING_LITERALS.NEWLINE);
    die(
      `${LOG_PREFIX} ❌ WU YAML validation failed:\n\n${errors}\n\n` +
        `Fix the issues above and retry.`,
    );
  }

  const completenessResult = validateSpecCompleteness(wuContent, id);
  if (!completenessResult.valid) {
    const errorList = completenessResult.errors
      .map((error) => `  • ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(
      `${LOG_PREFIX} ❌ WU SPEC INCOMPLETE:\n\n${errorList}\n\n` +
        `Provide the missing fields and retry.`,
    );
  }

  // WU-2253: Validate acceptance/code_paths consistency and invariants compliance
  // This blocks WU creation if acceptance references paths not in code_paths
  // or if code_paths conflicts with tools/invariants.yml
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const lintResult = lintWUSpec(wuContent, { invariantsPath });
  if (!lintResult.valid) {
    const formatted = formatLintErrors(lintResult.errors);
    die(
      `${LOG_PREFIX} ❌ WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before creating this WU.`,
    );
  }

  // WU-1352: Use centralized stringify (lineWidth: -1 = no wrapping for WU creation)
  // WU-1750: CRITICAL - Use validationResult.data (transformed) NOT wuContent (raw input)
  // This ensures embedded newlines are normalized before YAML output
  const yamlContent = stringifyYAML(validationResult.data, { lineWidth: -1 });

  writeFileSync(wuAbsolutePath, yamlContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} ✅ Created ${id}.yaml in micro-worktree`);

  return wuRelativePath;
}

/**
 * Update backlog.md in micro-worktree
 *
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} id - WU ID
 * @param {string} lane - WU lane
 * @param {string} title - WU title
 * @returns {string} Relative path to backlog.md
 */
function updateBacklogInWorktree(worktreePath, id, lane, title) {
  const backlogRelativePath = WU_PATHS.BACKLOG();
  const backlogAbsolutePath = join(worktreePath, backlogRelativePath);

  if (!existsSync(backlogAbsolutePath)) {
    // WU-1311: Use config-based backlog path in error message
    die(
      `Backlog not found in micro-worktree: ${backlogAbsolutePath}\n\n` +
        `Options:\n` +
        `  1. Ensure backlog.md exists at ${getConfig().directories.backlogPath}\n` +
        `  2. Run from repository root directory`,
    );
  }

  const { frontmatter, markdown } = parseBacklogFrontmatter(backlogAbsolutePath);

  if (!frontmatter) {
    die(
      'Backlog frontmatter missing in micro-worktree.\n\n' +
        'The backlog.md file requires YAML frontmatter to define section headings.\n\n' +
        'Options:\n' +
        '  1. Check backlog.md has valid YAML frontmatter between --- markers\n' +
        '  2. Ensure sections.ready.heading is defined in frontmatter',
    );
  }

  if (!frontmatter.sections?.ready?.heading) {
    die(
      'Invalid backlog frontmatter: Missing sections.ready.heading\n\n' +
        'Options:\n' +
        '  1. Add sections.ready.heading to backlog.md frontmatter\n' +
        '  2. Check frontmatter YAML structure',
    );
  }

  const readyHeading = frontmatter.sections.ready.heading;
  const insertionStrategy = frontmatter.sections.ready.insertion || 'after_heading_blank_line';

  const lines = markdown.split(STRING_LITERALS.NEWLINE);
  const headingIndex = lines.findIndex((line) => line === readyHeading);

  if (headingIndex === -1) {
    die(
      `Could not find Ready section heading: '${readyHeading}'\n\n` +
        `Options:\n` +
        `  1. Add the heading '${readyHeading}' to backlog.md\n` +
        `  2. Update sections.ready.heading in backlog.md frontmatter`,
    );
  }

  let insertionIndex;
  if (insertionStrategy === 'after_heading_blank_line') {
    const LINES_AFTER_HEADING = 2;
    insertionIndex = headingIndex + LINES_AFTER_HEADING;
  } else {
    die(
      `Unknown insertion strategy: ${insertionStrategy}\n\n` +
        `Options:\n` +
        `  1. Use 'after_heading_blank_line' in backlog.md frontmatter\n` +
        `  2. Check sections.ready.insertion value`,
    );
  }

  const newEntry = `- [${id} — ${title}](wu/${id}.yaml) — ${lane}`;
  lines.splice(insertionIndex, 0, newEntry);

  const updatedMarkdown = lines.join(STRING_LITERALS.NEWLINE);
  // WU-1352: Use centralized stringify for frontmatter
  const updatedBacklog = `---\n${stringifyYAML(frontmatter, { lineWidth: -1 })}---\n${updatedMarkdown}`;

  writeFileSync(backlogAbsolutePath, updatedBacklog, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  console.log(`${LOG_PREFIX} ✅ Updated backlog.md in micro-worktree`);

  return backlogRelativePath;
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
    console.warn(`${LOG_PREFIX} ⚠️  git config user.email not set - assigned_to will be empty`);
    return '';
  }
}

async function main() {
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
        `See .lumenflow.config.yaml for valid parent lanes.`,
    );
  }

  // WU-2330: Warn if a more specific sub-lane matches code_paths or description
  warnIfBetterLaneExists(args.lane, args.codePaths, args.title, args.description);

  // WU-1590: Build cloud create context for --cloud path
  const config = getConfig();
  const cloudDetection = detectCloudMode({
    cloudFlag: Boolean(args.cloud),
    env: process.env as Record<string, string | undefined>,
    config: config.cloud,
  });
  const cloudCtx = buildCloudCreateContext({
    cloud: cloudDetection.isCloud,
    currentBranch: cloudDetection.isCloud ? await getGitForCwd().getCurrentBranch() : 'main',
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
    console.warn(`${LOG_PREFIX} ⚠️  No assigned_to set - WU will need manual assignment`);
  }

  const planSpecRef = args.plan ? getPlanProtocolRef(wuId) : undefined;
  const mergedSpecRefs = mergeSpecRefs(args.specRefs, planSpecRef);

  // WU-1443: Apply resilient defaults so a plan-first WU doesn't immediately fail strict validation.
  const effectiveType = args.type || DEFAULT_TYPE;

  const resolvedNotes =
    typeof args.notes === 'string' && args.notes.trim().length > 0
      ? args.notes
      : WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER;
  if (resolvedNotes === WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER) {
    console.warn(
      `${LOG_PREFIX} ⚠️  No --notes provided; using placeholder notes (edit before done).`,
    );
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

  if (canAutoAddManualTests) {
    console.warn(
      `${LOG_PREFIX} ⚠️  No test paths provided; inserting a minimal manual test stub (add automated tests before code changes).`,
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
      specRefs: mergedSpecRefs,
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
      .map((error) => `  • ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} ❌ Spec validation failed:\n\n${errorList}`);
  }

  console.log(`${LOG_PREFIX} ✅ Spec validation passed`);

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
      specRefs: mergedSpecRefs,
      initiative: args.initiative,
      phase: args.phase,
      blockedBy: args.blockedBy,
      blocks: args.blocks,
      labels: args.labels,
      assignedTo,
    },
  });
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const preflightLint = lintWUSpec(preflightWU, { invariantsPath });
  if (!preflightLint.valid) {
    const formatted = formatLintErrors(preflightLint.errors);
    die(
      `${LOG_PREFIX} ❌ WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before creating this WU.`,
    );
  }

  const specRefsList = mergedSpecRefs;
  const specRefsValidation = validateSpecRefs(specRefsList);
  if (!specRefsValidation.valid) {
    const errorList = specRefsValidation.errors
      .map((error) => `  • ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} ❌ Spec reference validation failed:\n\n${errorList}`);
  }
  if (specRefsValidation.warnings.length > 0) {
    for (const warning of specRefsValidation.warnings) {
      console.warn(`${LOG_PREFIX} ⚠️  ${warning}`);
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
        console.warn(`${LOG_PREFIX} ⚠️  ${warning}`);
      }
    }
  }

  if (args.plan) {
    createPlanTemplate(wuId, args.title);
  }

  // Transaction: micro-worktree isolation (WU-1439) or cloud direct commit (WU-1590)
  try {
    const priority = args.priority || DEFAULT_PRIORITY;
    const type = effectiveType;

    // WU-1590: Shared create options for both paths
    const createOpts = {
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
      specRefs: mergedSpecRefs,
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
      const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
      process.env.LUMENFLOW_WU_TOOL = OPERATION_NAME;
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
          delete process.env.LUMENFLOW_WU_TOOL;
        } else {
          process.env.LUMENFLOW_WU_TOOL = previousWuTool;
        }
      }
    }

    console.log(`\n${LOG_PREFIX} ✅ Transaction complete!`);
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
