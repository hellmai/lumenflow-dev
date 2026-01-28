#!/usr/bin/env node
/**
 * pre-commit hook - Block direct commits to main/master
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1070: Audit logging for LUMENFLOW_FORCE bypass
 * WU-1164: Validate staged WU YAML files against schema
 *
 * Rules:
 * - BLOCK commits to main/master (use wu:claim workflow)
 * - ALLOW commits on lane branches (message validation in commit-msg)
 * - RESPECT Branch-Only mode (check claimed_mode in WU YAML)
 *
 * Escape hatch: LUMENFLOW_FORCE=1 (logged to ._legacy/force-bypasses.log)
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// WU-1070: Inline audit logging (fail-open, no external imports for hook reliability)
function logForceBypass(hookName, projectRoot) {
  if (process.env.LUMENFLOW_FORCE !== '1') return;

  const reason = process.env.LUMENFLOW_FORCE_REASON;
  if (!reason) {
    console.warn(
      `[${hookName}] Warning: LUMENFLOW_FORCE_REASON not set. ` +
        'Consider: LUMENFLOW_FORCE_REASON="reason" LUMENFLOW_FORCE=1 git ...',
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
    const legacyDir = join(projectRoot, '._legacy');
    const logPath = join(legacyDir, 'force-bypasses.log');

    if (!existsSync(legacyDir)) {
      mkdirSync(legacyDir, { recursive: true });
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
    console.error('');
    console.error('BLOCKED: Direct commit to', branch);
    console.error('');
    console.error('LumenFlow requires work to happen on lane branches.');
    console.error('');
    console.error('To start work on a WU:');
    console.error('  pnpm wu:claim --id WU-XXXX --lane <Lane>');
    console.error('  cd worktrees/<lane>-wu-xxxx');
    console.error('');
    console.error('To bypass (emergency only):');
    console.error('  LUMENFLOW_FORCE=1 git commit ...');
    console.error('');
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

            if (claimedMode === 'branch-only') {
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
            console.error('To bypass (emergency only):');
            console.error('  LUMENFLOW_FORCE=1 git commit ...');
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
