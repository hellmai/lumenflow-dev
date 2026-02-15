#!/usr/bin/env node
/**
 * @file doctor.ts
 * LumenFlow health check command (WU-1177)
 * WU-1191: Lane health check integration
 * WU-1386: Agent-friction checks (managed-file dirty, WU validity, worktree sanity)
 * Verifies all safety components are installed and configured correctly
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createWUParser,
  getResolvedPaths,
  detectOrphanWorktrees,
  detectMissingTrackedWorktrees,
} from '@lumenflow/core';
import { loadLaneDefinitions, detectLaneOverlaps } from './lane-health.js';
import { runCLI } from './cli-entry-point.js';

/**
 * Check result for a single component
 */
export interface CheckResult {
  passed: boolean;
  message: string;
  details?: string;
}

/**
 * Vendor config check result
 */
export interface VendorConfigResult {
  present: boolean;
  path: string;
  inSync?: boolean;
}

/**
 * Prerequisite check result
 */
export interface PrerequisiteResult {
  passed: boolean;
  version: string;
  required: string;
  message?: string;
}

/**
 * WU-1386: Managed files dirty check result
 */
export interface ManagedFilesDirtyResult {
  passed: boolean;
  files: string[];
  message: string;
}

/**
 * WU-1386: Worktree sanity check result
 */
export interface WorktreeSanityResult {
  passed: boolean;
  orphans: number;
  stale: number;
  message: string;
}

/**
 * WU-1386: WU validity check result (--deep mode only)
 */
export interface WUValidityResult {
  passed: boolean;
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  message: string;
}

/**
 * WU-1386: Workflow health checks section
 */
export interface WorkflowHealthResult {
  managedFilesDirty: ManagedFilesDirtyResult;
  worktreeSanity: WorktreeSanityResult;
  /** Only present with --deep flag */
  wuValidity?: WUValidityResult;
}

/**
 * Complete doctor result
 */
export interface DoctorResult {
  status: 'ACTIVE' | 'INCOMPLETE';
  /** WU-1386: New exit code system (0=healthy, 1=warnings, 2=errors) */
  exitCode: 0 | 1 | 2;
  checks: {
    husky: CheckResult;
    safeGit: CheckResult;
    agentsMd: CheckResult;
    lumenflowConfig: CheckResult;
    /** WU-1191: Lane health check result */
    laneHealth: CheckResult;
  };
  vendorConfigs: {
    claude: VendorConfigResult;
    cursor: VendorConfigResult;
    windsurf: VendorConfigResult;
    cline: VendorConfigResult;
    codex: VendorConfigResult;
  };
  prerequisites: {
    node: PrerequisiteResult;
    pnpm: PrerequisiteResult;
    git: PrerequisiteResult;
  };
  /** WU-1386: Workflow health checks (agent-friction detection) */
  workflowHealth?: WorkflowHealthResult;
}

/**
 * WU-1386: Options for runDoctor
 */
export interface DoctorOptions {
  /** Run heavier WU validity checks */
  deep?: boolean;
}

/**
 * WU-1386: Result for non-blocking init auto-run
 */
export interface DoctorForInitResult {
  blocked: boolean;
  warnings: number;
  errors: number;
  output: string;
}

/**
 * WU-1386: Managed files that should not have uncommitted changes
 */
const MANAGED_FILE_PATTERNS = [
  '.lumenflow.config.yaml',
  '.lumenflow.lane-inference.yaml',
  'AGENTS.md',
  'CLAUDE.md',
];

/** WU-1386: Managed directories with glob patterns */
const MANAGED_DIR_PATTERNS = ['docs/04-operations/tasks/'];

/**
 * CLI option definitions for doctor command
 * WU-1386: Added --deep flag
 */
const DOCTOR_OPTIONS = {
  verbose: {
    name: 'verbose',
    flags: '-v, --verbose',
    description: 'Show detailed output including all checks',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output results as JSON',
  },
  deep: {
    name: 'deep',
    flags: '--deep',
    description: 'Run heavier checks including WU validation (slower)',
  },
};

/**
 * Parse doctor command options
 * WU-1386: Added deep flag
 */
export function parseDoctorOptions(): {
  verbose: boolean;
  json: boolean;
  deep: boolean;
} {
  const opts = createWUParser({
    name: 'lumenflow-doctor',
    description: 'Check LumenFlow safety components and configuration',
    options: Object.values(DOCTOR_OPTIONS),
  });

  return {
    verbose: opts.verbose ?? false,
    json: opts.json ?? false,
    deep: opts.deep ?? false,
  };
}

/**
 * Check if Husky hooks are installed
 */
function checkHusky(projectDir: string): CheckResult {
  const huskyDir = path.join(projectDir, '.husky');
  const preCommit = path.join(huskyDir, 'pre-commit');

  if (!fs.existsSync(huskyDir)) {
    return {
      passed: false,
      message: 'Husky hooks not installed',
      details: 'Run: pnpm install && pnpm prepare',
    };
  }

  if (!fs.existsSync(preCommit)) {
    return {
      passed: false,
      message: 'Husky pre-commit hook missing',
      details: 'Run: pnpm prepare',
    };
  }

  return {
    passed: true,
    message: 'Husky hooks installed (.husky/pre-commit)',
  };
}

/**
 * Check if safe-git wrapper is present
 */
function checkSafeGit(projectDir: string): CheckResult {
  // WU-1654: Read safe-git path from config instead of hardcoding
  let safeGitPath: string;
  try {
    const resolved = getResolvedPaths({ projectRoot: projectDir });
    safeGitPath = resolved.safeGitPath;
  } catch {
    // Graceful fallback if config can't be loaded
    safeGitPath = path.join(projectDir, 'scripts', 'safe-git');
  }
  const relativePath = path.relative(projectDir, safeGitPath);

  if (!fs.existsSync(safeGitPath)) {
    return {
      passed: false,
      message: 'Safe-git wrapper missing',
      details: `The ${relativePath} file should exist to block destructive git commands`,
    };
  }

  return {
    passed: true,
    message: `Safe-git wrapper present (${relativePath})`,
  };
}

/**
 * Check if AGENTS.md exists
 */
function checkAgentsMd(projectDir: string): CheckResult {
  const agentsMdPath = path.join(projectDir, 'AGENTS.md');

  if (!fs.existsSync(agentsMdPath)) {
    return {
      passed: false,
      message: 'AGENTS.md missing',
      details: 'Run: lumenflow init to create universal agent instructions',
    };
  }

  return {
    passed: true,
    message: 'AGENTS.md exists',
  };
}

/**
 * Check if .lumenflow.config.yaml exists
 */
function checkLumenflowConfig(projectDir: string): CheckResult {
  const configPath = path.join(projectDir, '.lumenflow.config.yaml');

  if (!fs.existsSync(configPath)) {
    return {
      passed: false,
      message: 'LumenFlow config missing',
      details: 'Run: lumenflow init to create configuration',
    };
  }

  return {
    passed: true,
    message: 'LumenFlow config present (.lumenflow.config.yaml)',
  };
}

/**
 * Check vendor-specific config files
 */
function checkVendorConfigs(projectDir: string): DoctorResult['vendorConfigs'] {
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  const cursorRulesPath = path.join(projectDir, '.cursor', 'rules', 'lumenflow.md');
  const windsurfRulesPath = path.join(projectDir, '.windsurf', 'rules', 'lumenflow.md');
  const clineRulesPath = path.join(projectDir, '.clinerules');
  const agentsMdPath = path.join(projectDir, 'AGENTS.md');

  return {
    claude: {
      present: fs.existsSync(claudeMdPath),
      path: 'CLAUDE.md',
    },
    cursor: {
      present: fs.existsSync(cursorRulesPath),
      path: '.cursor/rules/lumenflow.md',
    },
    windsurf: {
      present: fs.existsSync(windsurfRulesPath),
      path: '.windsurf/rules/lumenflow.md',
    },
    cline: {
      present: fs.existsSync(clineRulesPath),
      path: '.clinerules',
    },
    codex: {
      // Codex reads AGENTS.md directly
      present: fs.existsSync(agentsMdPath),
      path: 'AGENTS.md',
    },
  };
}

/**
 * Get command version safely using execFileSync (no shell injection risk)
 */
function getCommandVersion(command: string, args: string[]): string {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output;
  } catch {
    return 'not found';
  }
}

/**
 * Parse semver version string to compare
 */
function parseVersion(versionStr: string): number[] {
  // eslint-disable-next-line security/detect-unsafe-regex -- static semver pattern; no backtracking risk
  const match = versionStr.match(/(\d+)\.(\d+)\.?(\d+)?/);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3] || '0', 10)];
}

/**
 * Compare versions: returns true if actual >= required
 */
function compareVersions(actual: string, required: string): boolean {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);

  for (let i = 0; i < 3; i++) {
    if (actualParts[i] > requiredParts[i]) {
      return true;
    }
    if (actualParts[i] < requiredParts[i]) {
      return false;
    }
  }
  return true;
}

/**
 * WU-1191: Check lane health configuration
 * Integrates lane:health overlap detection into lumenflow doctor
 */
function checkLaneHealth(projectDir: string): CheckResult {
  const lanes = loadLaneDefinitions(projectDir);

  // No lanes configured - considered healthy (nothing to check)
  if (lanes.length === 0) {
    return {
      passed: true,
      message: 'No lane definitions found - skipping lane health check',
    };
  }

  // Check for overlapping code_paths
  const overlapResult = detectLaneOverlaps(lanes);

  if (overlapResult.hasOverlaps) {
    const overlapCount = overlapResult.overlaps.length;
    const firstOverlap = overlapResult.overlaps[0];
    const laneNames = firstOverlap.lanes.join(' <-> ');

    return {
      passed: false,
      message: `Lane overlap detected: ${overlapCount} overlap(s) found`,
      details: `First overlap: ${laneNames}. Run 'pnpm lane:health' for full report.`,
    };
  }

  return {
    passed: true,
    message: `Lane configuration healthy (${lanes.length} lanes, no overlaps)`,
  };
}

/**
 * Check prerequisite versions
 */
function checkPrerequisites(): DoctorResult['prerequisites'] {
  const nodeVersion = getCommandVersion('node', ['--version']);
  const pnpmVersion = getCommandVersion('pnpm', ['--version']);
  const gitVersion = getCommandVersion('git', ['--version']);

  const requiredNode = '22.0.0';
  const requiredPnpm = '9.0.0';
  const requiredGit = '2.0.0';

  const nodeOk = nodeVersion !== 'not found' && compareVersions(nodeVersion, requiredNode);
  const pnpmOk = pnpmVersion !== 'not found' && compareVersions(pnpmVersion, requiredPnpm);
  const gitOk = gitVersion !== 'not found' && compareVersions(gitVersion, requiredGit);

  return {
    node: {
      passed: nodeOk,
      version: nodeVersion,
      required: `>=${requiredNode}`,
      message: nodeOk ? undefined : `Node.js ${requiredNode}+ required`,
    },
    pnpm: {
      passed: pnpmOk,
      version: pnpmVersion,
      required: `>=${requiredPnpm}`,
      message: pnpmOk ? undefined : `pnpm ${requiredPnpm}+ required`,
    },
    git: {
      passed: gitOk,
      version: gitVersion,
      required: `>=${requiredGit}`,
      message: gitOk ? undefined : `Git ${requiredGit}+ required`,
    },
  };
}

/**
 * WU-1387: Get git repository root directory
 * This ensures managed-file detection works from subdirectories
 */
function getGitRepoRoot(projectDir: string): string | null {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return repoRoot;
  } catch {
    return null;
  }
}

/**
 * WU-1386: Check for uncommitted changes to managed files
 * WU-1387: Uses git repo root for path resolution (works from subdirectories)
 */
async function checkManagedFilesDirty(projectDir: string): Promise<ManagedFilesDirtyResult> {
  try {
    // WU-1387: Get git repo root to handle subdirectory execution
    const repoRoot = getGitRepoRoot(projectDir);
    if (!repoRoot) {
      return {
        passed: true,
        files: [],
        message: 'Git status check skipped (not a git repository)',
      };
    }

    // Run git status from repo root, not the passed projectDir
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const statusOutput = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const dirtyFiles: string[] = [];

    // Parse status output and check each line
    const lines = statusOutput.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      // Status format: XY filename (where XY is 2-char status)
      const filePath = line.slice(3).trim();
      if (!filePath) continue;

      // Check if file matches managed patterns
      const isManaged =
        MANAGED_FILE_PATTERNS.some((pattern) => filePath === pattern) ||
        MANAGED_DIR_PATTERNS.some((dir) => filePath.startsWith(dir));

      if (isManaged) {
        dirtyFiles.push(filePath);
      }
    }

    if (dirtyFiles.length > 0) {
      return {
        passed: false,
        files: dirtyFiles,
        message: `${dirtyFiles.length} managed file(s) have uncommitted changes`,
      };
    }

    return {
      passed: true,
      files: [],
      message: 'No uncommitted changes to managed files',
    };
  } catch {
    // Not a git repo or git not available - graceful degradation
    return {
      passed: true,
      files: [],
      message: 'Git status check skipped (not a git repository)',
    };
  }
}

/**
 * WU-1654: Check worktree sanity using @lumenflow/core orphan-detector directly.
 * Replaces the previous approach of shelling out to wu:prune and parsing text with regexes.
 * Library-first: uses structured detectOrphanWorktrees() and detectMissingTrackedWorktrees().
 */
async function checkWorktreeSanity(projectDir: string): Promise<WorktreeSanityResult> {
  try {
    // First check if this is a git repo
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // WU-1654: Call orphan-detector functions directly instead of shelling out to wu:prune
    const orphanResult = await detectOrphanWorktrees(projectDir);
    const missingTracked = await detectMissingTrackedWorktrees(projectDir);

    const orphanCount = orphanResult.orphans.length;
    const missingCount = missingTracked.length;
    const errorCount = orphanResult.errors.length;
    const totalIssues = orphanCount + missingCount + errorCount;
    const passed = totalIssues === 0;

    // Build descriptive message preserving WorktreeSanityResult contract
    let message = 'All worktrees are valid';
    if (!passed) {
      const parts: string[] = [];
      if (orphanCount > 0) parts.push(`${orphanCount} orphan(s)`);
      if (missingCount > 0) parts.push(`${missingCount} missing`);
      if (errorCount > 0) parts.push(`${errorCount} error(s)`);
      message = `Worktree issues: ${parts.join(', ')}`;
    }

    return {
      passed,
      orphans: orphanCount,
      stale: missingCount, // Combined non-orphan issues for API compat
      message,
    };
  } catch {
    // Not a git repo or git not available
    return {
      passed: true,
      orphans: 0,
      stale: 0,
      message: 'Worktree check skipped (not a git repository)',
    };
  }
}

/**
 * WU-1386: Run WU validation (--deep mode only)
 * WU-1387: Sets passed=false with clear message when CLI fails to run
 * Calls wu:validate --all --no-strict for full schema/lint validation in warn-only mode
 */
async function checkWUValidity(projectDir: string): Promise<WUValidityResult> {
  const wuDir = path.join(projectDir, 'docs', '04-operations', 'tasks', 'wu');

  if (!fs.existsSync(wuDir)) {
    return {
      passed: true,
      total: 0,
      valid: 0,
      invalid: 0,
      warnings: 0,
      message: 'No WU directory found',
    };
  }

  try {
    // Call wu:validate --all --no-strict to get warn-only validation
    // This runs the full schema + lint validation, treating warnings as advisory
    let validateOutput: string;
    let cliError = false;
    let cliErrorMessage = '';
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- pnpm resolved from PATH; CLI orchestration
      validateOutput = execFileSync('pnpm', ['wu:validate', '--all', '--no-strict'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000, // 60 second timeout for full validation
      });
    } catch (e: unknown) {
      // wu:validate exits non-zero if validation fails
      const execError = e as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
        code?: string;
      };
      validateOutput = (execError.stdout || '') + (execError.stderr || '');
      const errorMsg = execError.message || '';

      // WU-1387: Distinguish between CLI execution failure and validation failure
      // CLI failure = script missing, command not found, ENOENT
      // Validation failure = script ran but found invalid WUs
      if (
        errorMsg.includes('ERR_PNPM') ||
        errorMsg.includes('ENOENT') ||
        errorMsg.includes('Missing script') ||
        errorMsg.includes('command not found') ||
        execError.code === 'ENOENT' ||
        // If no recognizable wu:validate output, assume CLI failed
        (!validateOutput.includes('[wu:validate]') && !validateOutput.includes('Valid:'))
      ) {
        cliError = true;
        cliErrorMessage = errorMsg.includes('Missing script')
          ? 'wu:validate script not found'
          : errorMsg.includes('ENOENT')
            ? 'pnpm command not available'
            : 'wu:validate could not run';
      }
    }

    // WU-1387: If CLI failed to run, report as failure with clear message
    if (cliError) {
      return {
        passed: false,
        total: 0,
        valid: 0,
        invalid: 0,
        warnings: 0,
        message: `WU validation failed: ${cliErrorMessage}`,
      };
    }

    // Parse output for counts
    // wu:validate outputs summary like:
    //   ✓ Valid: N
    //   ✗ Invalid: N
    //   ⚠ Warnings: N
    const validMatch = validateOutput.match(/Valid:\s*(\d+)/);
    const invalidMatch = validateOutput.match(/Invalid:\s*(\d+)/);
    const warningMatch = validateOutput.match(/Warnings:\s*(\d+)/);

    const validCount = validMatch ? parseInt(validMatch[1], 10) : 0;
    const invalidCount = invalidMatch ? parseInt(invalidMatch[1], 10) : 0;
    const warningCount = warningMatch ? parseInt(warningMatch[1], 10) : 0;
    const total = validCount + invalidCount;

    // In warn-only mode (--no-strict), we only fail on actual invalid WUs
    const passed = invalidCount === 0;

    return {
      passed,
      total,
      valid: validCount,
      invalid: invalidCount,
      warnings: warningCount,
      message: passed
        ? total > 0
          ? `All ${total} WU(s) valid${warningCount > 0 ? ` (${warningCount} warning(s))` : ''}`
          : 'No WUs to validate'
        : `${invalidCount}/${total} WU(s) have issues`,
    };
  } catch (e: unknown) {
    // WU-1387: Unexpected errors should report failure, not silently pass
    const error = e as Error;
    return {
      passed: false,
      total: 0,
      valid: 0,
      invalid: 0,
      warnings: 0,
      message: `WU validation failed: ${error.message || 'unknown error'}`,
    };
  }
}

/**
 * Run all doctor checks
 * WU-1386: Added options parameter for --deep flag
 */
export async function runDoctor(
  projectDir: string,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const checks = {
    husky: checkHusky(projectDir),
    safeGit: checkSafeGit(projectDir),
    agentsMd: checkAgentsMd(projectDir),
    lumenflowConfig: checkLumenflowConfig(projectDir),
    // WU-1191: Lane health check
    laneHealth: checkLaneHealth(projectDir),
  };

  const vendorConfigs = checkVendorConfigs(projectDir);
  const prerequisites = checkPrerequisites();

  // WU-1386: Workflow health checks
  const managedFilesDirty = await checkManagedFilesDirty(projectDir);
  const worktreeSanity = await checkWorktreeSanity(projectDir);

  const workflowHealth: WorkflowHealthResult = {
    managedFilesDirty,
    worktreeSanity,
  };

  // WU-1386: WU validity check only in --deep mode
  if (options.deep) {
    workflowHealth.wuValidity = await checkWUValidity(projectDir);
  }

  // Determine overall status
  // Note: laneHealth is advisory (not included in critical checks)
  const criticalChecks = [checks.husky, checks.safeGit, checks.agentsMd];
  const allCriticalPassed = criticalChecks.every((check) => check.passed);

  // WU-1386: Calculate exit code
  // 0 = healthy (all checks pass, no warnings)
  // 1 = warnings (non-critical issues)
  // 2 = errors (critical safety checks failed)
  let exitCode: 0 | 1 | 2 = 0;

  if (!allCriticalPassed) {
    exitCode = 2;
  } else if (
    !managedFilesDirty.passed ||
    !worktreeSanity.passed ||
    (workflowHealth.wuValidity && !workflowHealth.wuValidity.passed)
  ) {
    exitCode = 1;
  }

  return {
    status: allCriticalPassed ? 'ACTIVE' : 'INCOMPLETE',
    exitCode,
    checks,
    vendorConfigs,
    prerequisites,
    workflowHealth,
  };
}

/**
 * WU-1386: Run doctor for init (non-blocking, warnings only)
 * WU-1387: Shows accurate status including lane health and prerequisite failures
 * This is used after lumenflow init to provide feedback without blocking
 */
export async function runDoctorForInit(projectDir: string): Promise<DoctorForInitResult> {
  const result = await runDoctor(projectDir, { deep: false });

  // Count warnings and errors using check keys, not messages
  let warnings = 0;
  let errors = 0;

  // Critical checks that count as errors (if they fail, safety is compromised)
  const criticalCheckKeys = ['husky', 'safeGit', 'agentsMd'] as const;

  for (const [key, check] of Object.entries(result.checks)) {
    if (!check.passed) {
      if (criticalCheckKeys.includes(key as (typeof criticalCheckKeys)[number])) {
        errors++;
      } else {
        warnings++;
      }
    }
  }

  // WU-1387: Count prerequisite failures as warnings
  for (const [, prereq] of Object.entries(result.prerequisites)) {
    if (!prereq.passed) {
      warnings++;
    }
  }

  // Count workflow health issues as warnings (not errors)
  if (result.workflowHealth) {
    if (!result.workflowHealth.managedFilesDirty.passed) warnings++;
    if (!result.workflowHealth.worktreeSanity.passed) warnings++;
  }

  // Format concise output
  const lines: string[] = [];
  lines.push('[lumenflow doctor] Quick health check...');

  if (result.exitCode === 0 && warnings === 0) {
    lines.push('  All checks passed');
  } else {
    // Show critical errors first
    if (!result.checks.husky.passed) {
      lines.push('  Error: Husky hooks not installed');
    }
    if (!result.checks.safeGit.passed) {
      lines.push('  Error: safe-git script not found');
    }
    if (!result.checks.agentsMd.passed) {
      lines.push('  Error: AGENTS.md not found');
    }

    // WU-1387: Show lane health issues
    if (!result.checks.laneHealth.passed) {
      lines.push(`  Warning: Lane overlap detected - ${result.checks.laneHealth.message}`);
    }

    // WU-1387: Show prerequisite failures
    if (!result.prerequisites.node.passed) {
      lines.push(
        `  Warning: Node.js version ${result.prerequisites.node.version} (required: ${result.prerequisites.node.required})`,
      );
    }
    if (!result.prerequisites.pnpm.passed) {
      lines.push(
        `  Warning: pnpm version ${result.prerequisites.pnpm.version} (required: ${result.prerequisites.pnpm.required})`,
      );
    }
    if (!result.prerequisites.git.passed) {
      lines.push(
        `  Warning: Git version ${result.prerequisites.git.version} (required: ${result.prerequisites.git.required})`,
      );
    }

    // Workflow health warnings
    if (result.workflowHealth?.managedFilesDirty.files.length) {
      lines.push(
        `  Warning: ${result.workflowHealth.managedFilesDirty.files.length} managed file(s) have uncommitted changes`,
      );
      for (const file of result.workflowHealth.managedFilesDirty.files.slice(0, 3)) {
        lines.push(`    -> ${file}`);
      }
    }
    if (result.workflowHealth?.worktreeSanity.orphans) {
      lines.push(
        `  Warning: ${result.workflowHealth.worktreeSanity.orphans} orphan worktree(s) found`,
      );
    }
    if (result.workflowHealth && !result.workflowHealth.worktreeSanity.passed) {
      // WU-1387: Show worktree sanity message if there are issues beyond orphans
      const wsSanity = result.workflowHealth.worktreeSanity;
      if (wsSanity.stale > 0 && wsSanity.orphans === 0) {
        lines.push(`  Warning: ${wsSanity.message}`);
      }
    }
  }

  return {
    blocked: false, // Never blocks init
    warnings,
    errors,
    output: lines.join('\n'),
  };
}

/**
 * Format doctor output for terminal display
 * WU-1386: Added workflow health section
 */
export function formatDoctorOutput(result: DoctorResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('LumenFlow Health Check');
  lines.push('─'.repeat(45));

  // Core safety checks
  lines.push('');
  lines.push('Core Safety Components:');

  const formatCheck = (check: CheckResult): string => {
    const symbol = check.passed ? '✓' : '✗';
    return `  ${symbol} ${check.message}`;
  };

  lines.push(formatCheck(result.checks.husky));
  lines.push(formatCheck(result.checks.safeGit));
  lines.push(formatCheck(result.checks.agentsMd));
  lines.push(formatCheck(result.checks.lumenflowConfig));

  // WU-1191: Lane Health section
  lines.push('');
  lines.push('Lane Health:');
  lines.push(formatCheck(result.checks.laneHealth));

  // WU-1386: Workflow Health section
  if (result.workflowHealth) {
    lines.push('');
    lines.push('Workflow Health:');
    const mfd = result.workflowHealth.managedFilesDirty;
    const mfdSymbol = mfd.passed ? '✓' : '⚠';
    lines.push(`  ${mfdSymbol} ${mfd.message}`);
    if (!mfd.passed && mfd.files.length > 0) {
      for (const file of mfd.files.slice(0, 5)) {
        lines.push(`     → ${file}`);
      }
      if (mfd.files.length > 5) {
        lines.push(`     → ... and ${mfd.files.length - 5} more`);
      }
    }

    const ws = result.workflowHealth.worktreeSanity;
    const wsSymbol = ws.passed ? '✓' : '⚠';
    lines.push(`  ${wsSymbol} ${ws.message}`);

    // WU validity (only in --deep mode)
    if (result.workflowHealth.wuValidity) {
      const wv = result.workflowHealth.wuValidity;
      const wvSymbol = wv.passed ? '✓' : '⚠';
      lines.push(`  ${wvSymbol} ${wv.message}`);
    }
  }

  // Vendor configs
  lines.push('');
  lines.push('Vendor Configs:');

  const vendors = ['claude', 'cursor', 'windsurf', 'cline', 'codex'] as const;
  for (const vendor of vendors) {
    const config = result.vendorConfigs[vendor];
    const symbol = config.present ? '✓' : '○';
    const status = config.present ? 'present' : 'not configured';
    lines.push(`  ${symbol} ${vendor}: ${status} (${config.path})`);
  }

  // Prerequisites
  lines.push('');
  lines.push('Prerequisites:');

  const prereqs = ['node', 'pnpm', 'git'] as const;
  for (const prereq of prereqs) {
    const check = result.prerequisites[prereq];
    const symbol = check.passed ? '✓' : '✗';
    const versionDisplay = check.version === 'not found' ? 'not found' : check.version;
    lines.push(`  ${symbol} ${prereq}: ${versionDisplay} (required: ${check.required})`);
  }

  // Summary
  lines.push('');
  lines.push('─'.repeat(45));
  lines.push(`LumenFlow safety: ${result.status}`);

  // WU-1386: Show exit code meaning
  if (result.exitCode === 1) {
    lines.push('');
    lines.push('Warnings detected (exit code 1). Use --deep for full WU validation.');
  } else if (result.exitCode === 2) {
    lines.push('');
    lines.push('To fix missing components:');
    lines.push('  pnpm install && pnpm prepare  # Install Husky hooks');
    lines.push('  lumenflow init                 # Create missing config files');
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format doctor output as JSON
 */
export function formatDoctorJson(result: DoctorResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * CLI entry point
 * WU-1386: Updated to use new exit codes
 */
export async function main(): Promise<void> {
  const opts = parseDoctorOptions();
  const projectDir = process.cwd();

  const result = await runDoctor(projectDir, { deep: opts.deep });

  if (opts.json) {
    console.log(formatDoctorJson(result));
  } else {
    console.log(formatDoctorOutput(result));
  }

  // WU-1386: Use new exit code system
  process.exit(result.exitCode);
}

// CLI invocation when run directly
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
