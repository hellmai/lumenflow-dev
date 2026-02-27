#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan Link Command (WU-1313)
 *
 * Links plan files to WUs (via spec_refs) or initiatives (via related_plan).
 * This replaces the initiative:plan command for linking to initiatives.
 *
 * Usage:
 *   pnpm plan:link --id WU-1313 --plan lumenflow://plans/WU-1313-plan.md
 *   pnpm plan:link --id INIT-001 --plan lumenflow://plans/INIT-001-plan.md
 *
 * Features:
 * - Auto-detects target type (WU or Initiative) from ID format
 * - Updates spec_refs for WUs, related_plan for initiatives
 * - Validates plan file exists before linking
 * - Uses micro-worktree isolation for atomic commits
 * - Idempotent: no error if already linked
 *
 * Context: WU-1313 (INIT-013 Plan Tooling)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import {
  withMicroWorktree,
  isRetryExhaustionError as coreIsRetryExhaustionError,
  formatRetryExhaustionError as coreFormatRetryExhaustionError,
} from '@lumenflow/core/micro-worktree';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { LOG_PREFIX as CORE_LOG_PREFIX } from '@lumenflow/core/wu-constants';

/** Log prefix for console output */
export const LOG_PREFIX = CORE_LOG_PREFIX.PLAN_LINK ?? '[plan:link]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'plan-link';

/**
 * WU-1621: operation-level push retry override for plan:link.
 */
export const PLAN_LINK_PUSH_RETRY_OVERRIDE = {
  retries: 8,
  min_delay_ms: 300,
  max_delay_ms: 4000,
};

/** LumenFlow URI scheme for plan references */
const PLAN_URI_SCHEME = 'lumenflow://plans/';

/** WU ID pattern */
const WU_ID_PATTERN = /^WU-\d+$/;

/** Initiative ID pattern */
const INIT_ID_PATTERN = /^INIT-[A-Z0-9]+$/i;

/** Target type */
type TargetType = 'wu' | 'initiative';

/**
 * Check if an error is a push retry exhaustion error.
 */
export function isRetryExhaustionError(error: Error): boolean {
  return coreIsRetryExhaustionError(error);
}

/**
 * Format retry exhaustion error with actionable command guidance.
 */
export function formatRetryExhaustionError(error: Error, id: string, planUri: string): string {
  return coreFormatRetryExhaustionError(error, {
    command: `pnpm plan:link --id ${id} --plan ${planUri}`,
  });
}

function parseYamlObject(rawText: string, entityLabel: string): Record<string, unknown> {
  const parsed = parseYAML(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die(`Invalid ${entityLabel} payload: YAML root must be an object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve the target type from an ID
 *
 * @param id - ID to check (WU-XXX or INIT-XXX)
 * @returns 'wu' or 'initiative'
 * @throws Error if ID format is invalid
 */
export function resolveTargetType(id: string): TargetType {
  if (!id) {
    die(`ID is required\n\nExpected format: WU-XXX or INIT-XXX`);
  }

  if (WU_ID_PATTERN.test(id)) {
    return 'wu';
  }

  if (INIT_ID_PATTERN.test(id)) {
    return 'initiative';
  }

  die(
    `Invalid ID format: "${id}"\n\n` +
      `Expected format:\n` +
      `  - WU ID: WU-<number> (e.g., WU-1313)\n` +
      `  - Initiative ID: INIT-<alphanumeric> (e.g., INIT-001, INIT-TOOLING)`,
  );

  // TypeScript requires a return here even though die() never returns
  return 'wu';
}

/**
 * Validate that the plan file exists
 *
 * @param worktreePath - Path to repo root or worktree
 * @param planUri - Plan URI (lumenflow://plans/...)
 * @throws Error if plan file doesn't exist
 */
export function validatePlanExists(worktreePath: string, planUri: string): void {
  const normalizedPlanUri = normalizePlanUri(planUri);
  // Extract filename from URI
  const filename = normalizedPlanUri.replace(PLAN_URI_SCHEME, '');
  const plansDir = join(worktreePath, WU_PATHS.PLANS_DIR());
  const planPath = join(plansDir, filename);

  if (!existsSync(planPath)) {
    die(
      `Plan file not found: ${planPath}\n\n` +
        `Create it first with: pnpm plan:create --id <ID> --title "Title"`,
    );
  }
}

/**
 * Normalize and validate plan URI input.
 * Enforces lumenflow://plans/ scheme and rejects absolute/traversal paths.
 */
export function normalizePlanUri(planUri: string): string {
  const raw = planUri.trim();
  if (!raw.startsWith(PLAN_URI_SCHEME)) {
    die(`Invalid plan URI: "${planUri}"\n\n` + `Expected format: lumenflow://plans/<filename>.md`);
  }

  const filename = raw.slice(PLAN_URI_SCHEME.length).replaceAll('\\', '/').trim();
  if (!filename) {
    die(`Invalid plan URI: "${planUri}"\n\n` + `Expected format: lumenflow://plans/<filename>.md`);
  }

  if (filename.startsWith('/') || filename.includes('/../') || filename.startsWith('../')) {
    die(
      `Invalid plan URI: "${planUri}"\n\n` +
        `Plan URI must not contain absolute or traversal segments.`,
    );
  }

  if (filename.includes('/./') || filename.startsWith('./')) {
    die(`Invalid plan URI: "${planUri}"\n\n` + `Plan URI must not contain dot segments.`);
  }

  return `${PLAN_URI_SCHEME}${filename}`;
}

/**
 * Link a plan to a WU by updating spec_refs
 *
 * @param worktreePath - Path to repo root or worktree
 * @param wuId - WU ID
 * @param planUri - Plan URI
 * @returns True if changes were made, false if already linked
 */
export function linkPlanToWU(worktreePath: string, wuId: string, planUri: string): boolean {
  const wuRelPath = WU_PATHS.WU(wuId);
  const wuAbsPath = join(worktreePath, wuRelPath);

  if (!existsSync(wuAbsPath)) {
    die(`WU not found: ${wuId}\n\nFile does not exist: ${wuAbsPath}`);
  }

  // Read raw YAML to preserve all fields
  const rawText = readFileSync(wuAbsPath, { encoding: 'utf-8' });
  const doc = parseYamlObject(rawText, `WU ${wuId}`);
  if (doc.id !== undefined && doc.id !== wuId) {
    die(`WU YAML id mismatch. Expected ${wuId}, found ${String(doc.id)}`);
  }

  // WU-1683: Set first-class plan field (symmetric with initiative related_plan)
  const existingPlan = doc.plan as string | undefined;

  if (existingPlan === planUri) {
    console.log(`${LOG_PREFIX} Plan already linked to ${wuId} (idempotent)`);
    return false;
  }

  if (existingPlan && existingPlan !== planUri) {
    console.warn(`${LOG_PREFIX} Replacing existing plan: ${existingPlan} -> ${planUri}`);
  }

  doc.plan = planUri;

  // Write back
  const out = stringifyYAML(doc, { lineWidth: -1 });
  writeFileSync(wuAbsPath, out, { encoding: 'utf-8' });

  console.log(`${LOG_PREFIX} Linked plan to ${wuId}: ${planUri}`);
  return true;
}

/**
 * Link a plan to an initiative by updating related_plan
 *
 * @param worktreePath - Path to repo root or worktree
 * @param initId - Initiative ID
 * @param planUri - Plan URI
 * @returns True if changes were made, false if already linked
 */
export function linkPlanToInitiative(
  worktreePath: string,
  initId: string,
  planUri: string,
): boolean {
  const initRelPath = INIT_PATHS.INITIATIVE(initId);
  const initAbsPath = join(worktreePath, initRelPath);

  if (!existsSync(initAbsPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initAbsPath}`);
  }

  // Read raw YAML to preserve all fields
  const rawText = readFileSync(initAbsPath, { encoding: 'utf-8' });
  const doc = parseYamlObject(rawText, `initiative ${initId}`);
  if (doc.id !== initId) {
    die(`Initiative YAML id mismatch. Expected ${initId}, found ${String(doc.id)}`);
  }

  // Check for existing related_plan
  const relatedPlan = doc.related_plan;
  if (relatedPlan !== undefined && typeof relatedPlan !== 'string') {
    die(`Invalid related_plan in ${initId}: expected string when present`);
  }
  const existingPlan = relatedPlan as string | undefined;

  if (existingPlan === planUri) {
    console.log(`${LOG_PREFIX} Plan already linked to ${initId} (idempotent)`);
    return false;
  }

  if (existingPlan && existingPlan !== planUri) {
    console.warn(`${LOG_PREFIX} Replacing existing related_plan: ${existingPlan} -> ${planUri}`);
  }

  // Update related_plan
  doc.related_plan = planUri;

  // Write back
  const out = stringifyYAML(doc, { lineWidth: -1 });
  writeFileSync(initAbsPath, out, { encoding: 'utf-8' });

  console.log(`${LOG_PREFIX} Linked plan to ${initId}: ${planUri}`);
  return true;
}

/**
 * Generate commit message for plan link operation
 *
 * @param id - WU or Initiative ID
 * @param planUri - Plan URI
 * @returns Commit message
 */
export function getCommitMessage(id: string, planUri: string): string {
  const idLower = id.toLowerCase();
  const filename = planUri.replace(PLAN_URI_SCHEME, '');
  return `docs: link plan ${filename} to ${idLower}`;
}

export async function main(): Promise<void> {
  const PLAN_OPTION = {
    name: 'plan',
    flags: '--plan <uri>',
    description: 'Plan URI (lumenflow://plans/...)',
  };

  const args = createWUParser({
    name: 'plan-link',
    description: 'Link a plan file to a WU or initiative',
    options: [WU_OPTIONS.id, PLAN_OPTION],
    required: ['id', 'plan'],
    allowPositionalId: true,
  });

  const id = args.id as string;
  const planUri = normalizePlanUri(args.plan as string);

  // Resolve target type
  const targetType = resolveTargetType(id);

  console.log(
    `${LOG_PREFIX} Linking plan to ${targetType === 'wu' ? 'WU' : 'initiative'} ${id}...`,
  );

  // Ensure on main for micro-worktree operations
  await ensureOnMain(getGitForCwd());

  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id,
      logPrefix: LOG_PREFIX,
      pushOnly: true,
      pushRetryOverride: PLAN_LINK_PUSH_RETRY_OVERRIDE,
      execute: async ({ worktreePath }) => {
        // Validate plan exists
        validatePlanExists(worktreePath, planUri);

        // Link plan based on target type
        let changed: boolean;
        let filePath: string;

        if (targetType === 'wu') {
          changed = linkPlanToWU(worktreePath, id, planUri);
          filePath = WU_PATHS.WU(id);
        } else {
          changed = linkPlanToInitiative(worktreePath, id, planUri);
          filePath = INIT_PATHS.INITIATIVE(id);
        }

        if (!changed) {
          console.log(`${LOG_PREFIX} No changes needed (already linked)`);
        }

        return {
          commitMessage: getCommitMessage(id, planUri),
          files: [filePath],
        };
      },
    });

    console.log(`\n${LOG_PREFIX} Plan linked successfully!`);
    console.log(`\nLink Details:`);
    console.log(`  Target:  ${id} (${targetType})`);
    console.log(`  Plan:    ${planUri}`);
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      die(formatRetryExhaustionError(error, id, planUri));
    }
    die(
      `Plan linking failed: ${(error as Error).message}\n\n` +
        `Micro-worktree cleanup was attempted automatically.\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
    );
  }
}

// Guard main() for testability
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
