/**
 * WU State Reader for WU Context
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Reads WU state from YAML file and optionally cross-references
 * with state store for inconsistency detection.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { WU_PATHS } from '../wu-paths.js';

/**
 * Result of reading WU state.
 */
export interface WuStateResult {
  /** WU ID (uppercase, e.g., 'WU-1090') */
  id: string;
  /** Current status from YAML */
  status: string;
  /** Lane name */
  lane: string;
  /** WU title */
  title: string;
  /** Absolute path to WU YAML file */
  yamlPath: string;
  /** WU-1683: Path to linked plan file */
  plan?: string;
  /** Whether YAML and state store are consistent */
  isConsistent: boolean;
  /** Reason for inconsistency if not consistent */
  inconsistencyReason: string | null;
}

/**
 * Normalize WU ID to uppercase format.
 */
function normalizeWuId(id: string): string {
  const upper = id.toUpperCase();
  // Ensure it starts with WU-
  if (upper.startsWith('WU-')) return upper;
  return `WU-${upper.replace(/^WU-?/i, '')}`;
}

/**
 * Build the path to WU YAML file.
 * WU-1301: Uses config-based paths instead of hardcoded DIRECTORIES.
 */
function getWuYamlPath(wuId: string, repoRoot: string): string {
  const normalizedId = normalizeWuId(wuId);
  return join(repoRoot, WU_PATHS.WU(normalizedId));
}

/**
 * Read WU state from YAML and detect inconsistencies.
 *
 * @param wuId - WU ID (e.g., 'WU-1090' or 'wu-1090')
 * @param repoRoot - Repository root path
 * @returns WuStateResult or null if WU not found
 */
export async function readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null> {
  const normalizedId = normalizeWuId(wuId);
  const yamlPath = getWuYamlPath(normalizedId, repoRoot);

  // Check if YAML exists
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    // Read and parse YAML
    const content = readFileSync(yamlPath, 'utf8');
    const yaml = parseYaml(content);

    if (!yaml || typeof yaml !== 'object') {
      return null;
    }

    // Extract fields with defaults
    const status = yaml.status || 'unknown';
    const lane = yaml.lane || '';
    const title = yaml.title || '';
    // WU-1683: Extract plan field
    const plan = typeof yaml.plan === 'string' ? yaml.plan : undefined;

    // WU-1755: Check worktree for divergent status.
    // When run from main, the YAML may show 'ready' while the worktree branch
    // has 'in_progress'. Uses execFileSync for safety (no shell injection).
    let isConsistent = true;
    let inconsistencyReason: string | null = null;
    let effectiveStatus = status;

    try {
      const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        encoding: 'utf-8',
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const wuIdLower = normalizedId.toLowerCase();
      const lines = worktreeList.split('\n');
      let worktreeBranch: string | undefined;

      for (const line of lines) {
        if (line.startsWith('branch ') && line.toLowerCase().includes(wuIdLower)) {
          worktreeBranch = line.replace('branch refs/heads/', '').trim();
          break;
        }
      }

      if (worktreeBranch) {
        const yamlRelPath = WU_PATHS.WU(normalizedId);
        try {
          const branchContent = execFileSync('git', ['show', `${worktreeBranch}:${yamlRelPath}`], {
            encoding: 'utf-8',
            cwd: repoRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const branchYaml = parseYaml(branchContent);
          const branchStatus = branchYaml?.status;

          if (branchStatus && branchStatus !== status) {
            isConsistent = false;
            inconsistencyReason = `Main shows '${status}' but worktree branch (${worktreeBranch}) shows '${branchStatus}'`;
            effectiveStatus = branchStatus;
          }
        } catch {
          // Branch doesn't have the YAML file yet
        }
      }
    } catch {
      // git worktree list failed — not in a git repo or git not available
    }

    return {
      id: normalizedId,
      status: effectiveStatus,
      lane,
      title,
      yamlPath,
      ...(plan && { plan }),
      isConsistent,
      inconsistencyReason,
    };
  } catch {
    // Parse error or read error
    return null;
  }
}
