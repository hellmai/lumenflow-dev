 
/**
 * @file doctor.ts
 * LumenFlow health check command (WU-1177)
 * WU-1191: Lane health check integration
 * Verifies all safety components are installed and configured correctly
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWUParser } from '@lumenflow/core';
import { loadLaneDefinitions, detectLaneOverlaps } from './lane-health.js';

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
 * Complete doctor result
 */
export interface DoctorResult {
  status: 'ACTIVE' | 'INCOMPLETE';
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
}

/**
 * CLI option definitions for doctor command
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
};

/**
 * Parse doctor command options
 */
export function parseDoctorOptions(): {
  verbose: boolean;
  json: boolean;
} {
  const opts = createWUParser({
    name: 'lumenflow-doctor',
    description: 'Check LumenFlow safety components and configuration',
    options: Object.values(DOCTOR_OPTIONS),
  });

  return {
    verbose: opts.verbose ?? false,
    json: opts.json ?? false,
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
  const safeGitPath = path.join(projectDir, 'scripts', 'safe-git');

  if (!fs.existsSync(safeGitPath)) {
    return {
      passed: false,
      message: 'Safe-git wrapper missing',
      details: 'The scripts/safe-git file should exist to block destructive git commands',
    };
  }

  return {
    passed: true,
    message: 'Safe-git wrapper present (scripts/safe-git)',
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
 * Run all doctor checks
 */
export async function runDoctor(projectDir: string): Promise<DoctorResult> {
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

  // Determine overall status
  // Note: laneHealth is advisory (not included in critical checks)
  const criticalChecks = [checks.husky, checks.safeGit, checks.agentsMd];
  const allCriticalPassed = criticalChecks.every((check) => check.passed);

  return {
    status: allCriticalPassed ? 'ACTIVE' : 'INCOMPLETE',
    checks,
    vendorConfigs,
    prerequisites,
  };
}

/**
 * Format doctor output for terminal display
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

  if (result.status === 'INCOMPLETE') {
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
 */
export async function main(): Promise<void> {
  const opts = parseDoctorOptions();
  const projectDir = process.cwd();

  const result = await runDoctor(projectDir);

  if (opts.json) {
    console.log(formatDoctorJson(result));
  } else {
    console.log(formatDoctorOutput(result));
  }

  // Exit with error code if incomplete
  if (result.status === 'INCOMPLETE') {
    process.exit(1);
  }
}

// CLI invocation when run directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Doctor failed:', error);
    process.exit(1);
  });
}
