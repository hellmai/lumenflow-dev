#!/usr/bin/env node
/**
 * pre-commit hook - Block direct commits to main/master
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1070: Audit logging for LUMENFLOW_FORCE bypass
 * WU-1164: Validate staged WU YAML files against schema
 * WU-1357: Educational error messages for main branch blocks
 *
 * Rules:
 * - BLOCK commits to main/master (use wu:claim workflow)
 * - ALLOW commits on lane branches (message validation in commit-msg)
 * - RESPECT Branch-Only mode (check claimed_mode in WU YAML)
 *
 * Escape hatch: LUMENFLOW_FORCE=1 (logged to .lumenflow/force-bypasses.log)
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * WU-1357: Educational message constants for main branch protection
 *
 * Design principles:
 * - Explain WHY before showing WHAT to do
 * - Provide multiple paths forward (not just one command)
 * - Put emergency bypass LAST with clear warnings
 * - Include help resources for learning
 *
 * Inlined for hook reliability (no external imports that could fail on broken builds)
 */
const MAIN_BRANCH_BLOCK_MESSAGES = {
  BOX: {
    TOP: '══════════════════════════════════════════════════════════════════',
    DIVIDER: '──────────────────────────────────────────────────────────────────',
  },
  WHY: {
    HEADER: 'WHY THIS HAPPENS',
    LINES: [
      'LumenFlow protects main from direct commits to ensure:',
      '  • All work is tracked in Work Units (WUs)',
      '  • Changes can be reviewed and coordinated',
      '  • Parallel work across lanes stays isolated',
    ],
  },
  ACTIONS: {
    HEADER: 'WHAT TO DO',
    HAVE_WU: {
      HEADER: '1. If you have a Work Unit to implement:',
      COMMANDS: ['pnpm wu:claim --id WU-XXXX --lane "<Lane>"', 'cd worktrees/<lane>-wu-xxxx'],
      NOTE: 'Then make your commits in the worktree',
    },
    NEED_WU: {
      HEADER: '2. If you need to create a new Work Unit:',
      COMMANDS: ['pnpm wu:create --lane "<Lane>" --title "Your task"'],
      NOTE: 'This generates a WU ID, then claim it as above',
    },
    LIST_LANES: {
      HEADER: '3. Not sure what lane to use?',
      COMMANDS: ['pnpm wu:list-lanes'],
    },
  },
  HELP: {
    HEADER: 'NEED HELP?',
    RESOURCES: [
      '• Read: LUMENFLOW.md (workflow overview)',
      '• Read: docs/04-operations/_frameworks/lumenflow/agent/onboarding/',
      '• Run:  pnpm wu:help',
    ],
  },
  RECOVERY: {
    HEADER: 'STUCK?',
    LINES: ['If you need to fix workflow state:', '  pnpm wu:recover --id WU-XXXX'],
  },
};

/**
 * Format the main branch block message for educational output
 *
 * WU-1357: Produces a structured, educational message explaining:
 * 1. WHY main is protected
 * 2. Multiple paths forward
 * 3. Help resources
 * 4. Emergency bypass (last)
 *
 * @param {string} branch - The blocked branch name (e.g., 'main', 'master')
 * @returns {string} Formatted multi-line message
 */
export function formatMainBranchBlockMessage(branch) {
  const { BOX, WHY, ACTIONS, HELP, RECOVERY } = MAIN_BRANCH_BLOCK_MESSAGES;
  const lines = [];

  // Title with box
  lines.push('');
  lines.push(BOX.TOP);
  lines.push(`  DIRECT COMMIT TO ${branch.toUpperCase()} BLOCKED`);
  lines.push(BOX.TOP);
  lines.push('');

  // WHY section
  lines.push(WHY.HEADER);
  lines.push(BOX.DIVIDER);
  for (const line of WHY.LINES) {
    lines.push(line);
  }
  lines.push('');

  // WHAT TO DO section
  lines.push(ACTIONS.HEADER);
  lines.push(BOX.DIVIDER);
  lines.push('');

  // Path 1: Have a WU
  lines.push(ACTIONS.HAVE_WU.HEADER);
  for (const cmd of ACTIONS.HAVE_WU.COMMANDS) {
    lines.push(`     ${cmd}`);
  }
  lines.push(`   ${ACTIONS.HAVE_WU.NOTE}`);
  lines.push('');

  // Path 2: Need to create WU
  lines.push(ACTIONS.NEED_WU.HEADER);
  for (const cmd of ACTIONS.NEED_WU.COMMANDS) {
    lines.push(`     ${cmd}`);
  }
  lines.push(`   ${ACTIONS.NEED_WU.NOTE}`);
  lines.push('');

  // Path 3: List lanes
  lines.push(ACTIONS.LIST_LANES.HEADER);
  for (const cmd of ACTIONS.LIST_LANES.COMMANDS) {
    lines.push(`     ${cmd}`);
  }
  lines.push('');

  // HELP section
  lines.push(HELP.HEADER);
  lines.push(BOX.DIVIDER);
  for (const resource of HELP.RESOURCES) {
    lines.push(resource);
  }
  lines.push('');

  // RECOVERY section (workflow-correct guidance)
  lines.push(BOX.DIVIDER);
  lines.push(RECOVERY.HEADER);
  lines.push(BOX.DIVIDER);
  for (const line of RECOVERY.LINES) {
    lines.push(line);
  }
  lines.push(BOX.DIVIDER);
  lines.push('');

  return lines.join('\n');
}

/**
 * WU-1595: Decide whether a lane-branch commit from main checkout is allowed.
 *
 * branch-only and branch-pr are no-worktree claim modes and should be allowed.
 */
export function shouldAllowMainCheckoutLaneCommit(claimedMode) {
  return claimedMode === 'branch-only' || claimedMode === 'branch-pr';
}

// WU-1070: Inline audit logging (fail-open, no external imports for hook reliability)
function logForceBypass(hookName, projectRoot) {
  if (process.env.LUMENFLOW_FORCE !== '1') return;

  const reason = process.env.LUMENFLOW_FORCE_REASON;
  if (!reason) {
    console.warn(
      `[${hookName}] Warning: LUMENFLOW_FORCE_REASON not set. ` +
        'Please provide a reason for the audit trail.',
    );
  }

  try {
    const timestamp = new Date().toISOString();
    let user = 'unknown';
    let branch = 'unknown';
    try {
      user = execSync('git config user.name', { encoding: 'utf8' }).trim();
    } catch {}
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {}

    const logLine = `${timestamp} | ${hookName} | ${user} | ${branch} | ${reason || '(no reason provided)'} | ${projectRoot}\n`;
    const lumenflowDir = join(projectRoot, '.lumenflow');
    const logPath = join(lumenflowDir, 'force-bypasses.log');

    if (!existsSync(lumenflowDir)) {
      mkdirSync(lumenflowDir, { recursive: true });
    }
    appendFileSync(logPath, logLine);
  } catch (error) {
    console.error(`[${hookName}] Warning: Failed to write audit log: ${error.message}`);
  }
}

export function filterStagedWUYamlFiles(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter(
    (p) =>
      typeof p === 'string' && p.startsWith('docs/04-operations/tasks/wu/') && p.endsWith('.yaml'),
  );
}

let cachedBaseWUSchema = null;
let cachedYamlParse = null;

function findMainCheckoutPath() {
  try {
    const out = execSync('git worktree list --porcelain', { encoding: 'utf8' });
    const lines = out.split('\n');

    let currentPath = null;
    let currentBranch = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('worktree ')) {
        currentPath = line.replace('worktree ', '').trim();
        currentBranch = null;
        continue;
      }
      if (line.startsWith('branch ')) {
        currentBranch = line.replace('branch ', '').trim();
        if (
          currentPath &&
          (currentBranch === 'refs/heads/main' || currentBranch === 'refs/heads/master')
        ) {
          return currentPath;
        }
      }
    }
  } catch {}
  return null;
}

async function loadBaseWUSchema(projectRoot) {
  if (cachedBaseWUSchema) return cachedBaseWUSchema;

  const candidates = [join(projectRoot, 'packages/@lumenflow/core/dist/wu-schema.js')];
  const mainCheckout = findMainCheckoutPath();
  if (mainCheckout) {
    candidates.push(join(mainCheckout, 'packages/@lumenflow/core/dist/wu-schema.js'));
  }

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const mod = await import(pathToFileURL(candidate).href);
      if (mod?.BaseWUSchema) {
        cachedBaseWUSchema = mod.BaseWUSchema;
        return cachedBaseWUSchema;
      }
    } catch {}
  }

  throw new Error(
    'Failed to load BaseWUSchema (missing packages/@lumenflow/core/dist/wu-schema.js)',
  );
}

async function loadYamlParse(projectRoot) {
  if (cachedYamlParse) return cachedYamlParse;

  const candidates = [
    join(projectRoot, 'packages/@lumenflow/core/node_modules/yaml/dist/index.js'),
    join(projectRoot, 'packages/@lumenflow/core/node_modules/yaml/browser/dist/index.js'),
  ];

  const mainCheckout = findMainCheckoutPath();
  if (mainCheckout) {
    candidates.push(join(mainCheckout, 'packages/@lumenflow/core/node_modules/yaml/dist/index.js'));
    candidates.push(
      join(mainCheckout, 'packages/@lumenflow/core/node_modules/yaml/browser/dist/index.js'),
    );
  }

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod?.parse === 'function') {
        cachedYamlParse = mod.parse;
        return cachedYamlParse;
      }
      if (typeof mod?.default?.parse === 'function') {
        cachedYamlParse = mod.default.parse;
        return cachedYamlParse;
      }
    } catch {}
  }

  throw new Error(
    'Failed to load YAML parser (yaml dependency not found under @lumenflow/core/node_modules)',
  );
}

export async function validateWUYamlString(yamlText, projectRoot) {
  const errors = [];

  let doc;
  try {
    const parseYaml = await loadYamlParse(projectRoot);
    doc = parseYaml(yamlText);
  } catch (error) {
    errors.push(`YAML parse error: ${error.message}`);
    return { valid: false, errors };
  }

  let BaseWUSchema;
  try {
    BaseWUSchema = await loadBaseWUSchema(projectRoot);
  } catch (error) {
    errors.push(`Schema load error: ${error.message}`);
    return { valid: false, errors };
  }

  const result = BaseWUSchema.safeParse(doc);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const fieldPath = issue.path.join('.') || '(root)';
      errors.push(`${fieldPath}: ${issue.message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function getStagedFileList() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readStagedFile(path) {
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' });
}

function findProjectRoot() {
  let projectRoot = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(projectRoot, '.lumenflow.config.yaml'))) break;
    const parent = dirname(projectRoot);
    if (parent === projectRoot) break;
    projectRoot = parent;
  }
  return projectRoot;
}

async function validateStagedWUYamlFiles(projectRoot) {
  let staged;
  try {
    staged = getStagedFileList();
  } catch {
    return { valid: true, errors: [] };
  }

  const wuYamlFiles = filterStagedWUYamlFiles(staged);
  if (wuYamlFiles.length === 0) return { valid: true, errors: [] };

  const errors = [];
  for (const filePath of wuYamlFiles) {
    let content;
    try {
      content = readStagedFile(filePath);
    } catch (error) {
      errors.push(`${filePath}: Failed to read staged content: ${error.message}`);
      continue;
    }

    const result = await validateWUYamlString(content, projectRoot);
    if (!result.valid) {
      errors.push(`${filePath}:`);
      for (const msg of result.errors) {
        errors.push(`  - ${msg}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function main() {
  const projectRoot = findProjectRoot();

  if (process.env.LUMENFLOW_FORCE === '1') {
    logForceBypass('pre-commit', projectRoot);
    process.exit(0);
  }

  let branch;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    process.exit(0);
  }

  const MAIN_BRANCHES = ['main', 'master'];
  const LANE_PREFIX = 'lane/';

  if (MAIN_BRANCHES.includes(branch)) {
    console.error(formatMainBranchBlockMessage(branch));
    process.exit(1);
  }

  if (branch.startsWith(LANE_PREFIX)) {
    const wuMatch = branch.match(/wu-\d+/i);
    if (wuMatch) {
      const wuId = wuMatch[0].toUpperCase();
      const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
      const isMainWorktree = gitDir === '.git';

      if (isMainWorktree) {
        const wuPath = join(projectRoot, 'docs/04-operations/tasks/wu', `${wuId}.yaml`);

        if (existsSync(wuPath)) {
          try {
            const content = readFileSync(wuPath, 'utf8');
            const modeMatch = content.match(/^claimed_mode:\s*(.+)$/m);
            const claimedMode = modeMatch ? modeMatch[1].trim() : null;

            if (shouldAllowMainCheckoutLaneCommit(claimedMode)) {
              process.exit(0);
            }

            console.error('');
            console.error('BLOCKED: Lane branch work should be in worktree');
            console.error('');
            console.error(`You're on branch ${branch} but in the main checkout.`);
            console.error('');
            console.error('Option 1: Work in the worktree:');
            console.error(`  cd worktrees/*-${wuId.toLowerCase()}`);
            console.error('');
            console.error('Option 2: Reclaim with --branch-only:');
            console.error(`  pnpm wu:claim --id ${wuId} --lane <Lane> --branch-only`);
            console.error('');
            console.error('Option 3: Fix workflow state:');
            console.error(`  pnpm wu:recover --id ${wuId}`);
            console.error('');
            process.exit(1);
          } catch {}
        }
      }
    }
  }

  const validation = await validateStagedWUYamlFiles(projectRoot);
  if (!validation.valid) {
    console.error('');
    console.error('[pre-commit] WU YAML validation failed for staged files');
    console.error('');
    for (const line of validation.errors) {
      console.error(line);
    }
    console.error('');
    process.exit(1);
  }

  process.exit(0);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath && invokedPath === modulePath) {
  void main();
}
