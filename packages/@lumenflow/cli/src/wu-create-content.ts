// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-content.ts
 * @description Content generation and YAML building for wu:create command (WU-1651)
 *
 * Extracted from wu-create.ts to isolate WU YAML content construction,
 * backlog updates, plan template creation, and commit message helpers.
 */

import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodIssue } from 'zod';
import { stringifyYAML } from '@lumenflow/core/wu-yaml';
import { todayISO } from '@lumenflow/core/date-utils';
import { parseBacklogFrontmatter } from '@lumenflow/core/backlog-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { getConfig } from '@lumenflow/core/config';
import { validateWU } from '@lumenflow/core/wu-schema';
import { getPlanPath, getPlanProtocolRef, getPlansDir } from '@lumenflow/core/lumenflow-home';
import { FILE_SYSTEM, STRING_LITERALS } from '@lumenflow/core/wu-constants';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import { lintWUSpec, formatLintErrors } from '@lumenflow/core/wu-lint';
import { isCodeFile } from '@lumenflow/core/manual-test-validator';
import { WU_CREATE_DEFAULTS } from '@lumenflow/core/wu-create-defaults';
import { isDocsOrProcessType, hasAnyTests } from '@lumenflow/core/wu-type-helpers';
import type { CreateWUOptions } from './wu-create-validation.js';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:create]';

/** Maximum title length before truncation */
const MAX_TITLE_LENGTH = 60;

/** Truncation suffix */
const TRUNCATION_SUFFIX = '...';

/** Truncated title length (MAX_TITLE_LENGTH - TRUNCATION_SUFFIX.length) */
const TRUNCATED_TITLE_LENGTH = MAX_TITLE_LENGTH - TRUNCATION_SUFFIX.length;

function containsCodeFiles(codePaths: string[] | undefined): boolean {
  if (!codePaths || codePaths.length === 0) return false;
  return codePaths.some((p) => isCodeFile(p));
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
    plan,
    sizingEstimate,
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
    // WU-1683: First-class plan field
    ...(plan && { plan }),
    // WU-2155: Pass through sizing_estimate to YAML output
    ...(sizingEstimate && { sizing_estimate: sizingEstimate }),
  };
}

/**
 * Truncate title for commit message if needed
 * @param {string} title - Original title
 * @returns {string} Truncated title
 */
export function truncateTitle(title: string) {
  return title.length > MAX_TITLE_LENGTH
    ? `${title.substring(0, TRUNCATED_TITLE_LENGTH)}${TRUNCATION_SUFFIX}`
    : title;
}

export function mergeSpecRefs(specRefs?: string[], extraRef?: string): string[] {
  const refs = specRefs ? [...specRefs] : [];
  if (extraRef && !refs.includes(extraRef)) {
    refs.push(extraRef);
  }
  return refs;
}

/**
 * WU-1755: Optional context to auto-populate plan template sections.
 * When provided, Goal and Success Criteria sections are pre-filled
 * instead of being empty headers that agents must manually edit.
 */
interface PlanTemplateContext {
  description?: string;
  acceptance?: string[];
}

export function createPlanTemplate(
  wuId: string,
  title: string,
  context?: PlanTemplateContext,
): string {
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

  // WU-1755: Pre-fill Goal from description and Success Criteria from acceptance
  const goalContent = context?.description ? `\n${context.description}\n` : '';
  const acceptanceContent =
    context?.acceptance && context.acceptance.length > 0
      ? `\n${context.acceptance.map((a) => `- ${a}`).join('\n')}\n`
      : '';

  const content =
    `# ${wuId} Plan — ${title}\n\n` +
    `Created: ${today}\n\n` +
    `## Goal\n${goalContent}\n` +
    `## Success Criteria\n${acceptanceContent}\n` +
    `## Scope\n\n` +
    `## Approach\n\n` +
    `## Risks\n\n` +
    `## Open Questions\n`;

  writeFileSync(planPath, content, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} Created plan template: ${planPath}`);
  return planPath;
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
export function createWUYamlInWorktree(
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
      .map((issue: ZodIssue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join(STRING_LITERALS.NEWLINE);
    die(
      `${LOG_PREFIX} WU YAML validation failed:\n\n${errors}\n\n` +
        `Fix the issues above and retry.`,
    );
  }

  const completenessResult = validateSpecCompleteness(wuContent, id);
  if (!completenessResult.valid) {
    const errorList = completenessResult.errors
      .map((error) => `  - ${error}`)
      .join(STRING_LITERALS.NEWLINE);
    die(
      `${LOG_PREFIX} WU SPEC INCOMPLETE:\n\n${errorList}\n\n` +
        `Provide the missing fields and retry.`,
    );
  }

  // WU-2253: Validate acceptance/code_paths consistency and invariants compliance
  // This blocks WU creation if acceptance references paths not in code_paths
  // or if code_paths conflicts with tools/invariants.yml
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const lintResult = lintWUSpec(wuContent, { invariantsPath, phase: 'intent' });
  if (!lintResult.valid) {
    const formatted = formatLintErrors(lintResult.errors);
    die(
      `${LOG_PREFIX} WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before creating this WU.`,
    );
  }

  // WU-1352: Use centralized stringify (lineWidth: -1 = no wrapping for WU creation)
  // WU-1750: CRITICAL - Use validationResult.data (transformed) NOT wuContent (raw input)
  // This ensures embedded newlines are normalized before YAML output
  const yamlContent = stringifyYAML(validationResult.data, { lineWidth: -1 });

  writeFileSync(wuAbsolutePath, yamlContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} Created ${id}.yaml in micro-worktree`);

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
export function updateBacklogInWorktree(
  worktreePath: string,
  id: string,
  lane: string,
  title: string,
) {
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
  console.log(`${LOG_PREFIX} Updated backlog.md in micro-worktree`);

  return backlogRelativePath;
}

/** Re-export getPlanProtocolRef for use in orchestrator */
export { getPlanProtocolRef };
